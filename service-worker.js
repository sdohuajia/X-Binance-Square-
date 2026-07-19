const SQUARE_URL = "https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add";
const ALARM = "x-square-retry";
const MAX_QUEUE = 100;
const MAX_ATTEMPTS = 10;

async function config() {
  return chrome.storage.local.get(["squareApiKey", "boundUsername", "enabled"]);
}
async function getQueue() {
  return (await chrome.storage.local.get("queue")).queue || {};
}
async function saveQueue(queue) {
  const entries = Object.entries(queue).sort((a,b) => b[1].created_at - a[1].created_at).slice(0, MAX_QUEUE);
  const compact = Object.fromEntries(entries);
  await chrome.storage.local.set({queue: compact});
  await updateBadge(compact);
}
async function updateBadge(queue) {
  const pending = Object.values(queue).filter(x => x.status !== "published").length;
  await chrome.action.setBadgeText({text: pending ? String(pending) : ""});
  await chrome.action.setBadgeBackgroundColor({color: pending ? "#D97706" : "#16A34A"});
}
async function setLast(value) {
  await chrome.storage.local.set({lastStatus: {...value, at: Date.now()}});
}
function normalizeUsername(value) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase();
}
async function publish(text, apiKey) {
  const response = await fetch(SQUARE_URL, {
    method: "POST",
    headers: {
      "X-Square-OpenAPI-Key": apiKey,
      "Content-Type": "application/json",
      "clienttype": "binanceSkill"
    },
    body: JSON.stringify({bodyTextOnly: text})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Binance HTTP ${response.status}`);
  if (String(payload.code) !== "000000") {
    const error = new Error(payload.message || `Binance code ${payload.code || "unknown"}`);
    error.permanent = !["100001", "100002"].includes(String(payload.code));
    throw error;
  }
  const id = String(payload.data?.id || "");
  if (!id) throw new Error("Binance returned success without a post ID");
  return {id, url: `https://www.binance.com/square/post/${id}`};
}
async function deliver(eventId) {
  const queue = await getQueue();
  const item = queue[eventId];
  if (!item || item.status === "published" || item.status === "blocked") return;
  const cfg = await config();
  if (cfg.enabled === false || !cfg.squareApiKey) return;
  try {
    item.status = "sending";
    item.updated_at = Date.now();
    queue[eventId] = item;
    await saveQueue(queue);
    const result = await publish(item.payload.text, cfg.squareApiKey);
    item.status = "published";
    item.square_id = result.id;
    item.square_url = result.url;
    item.last_error = "";
    await setLast({ok: true, event_id: eventId, square_url: result.url, username: item.payload.username});
  } catch (error) {
    item.attempts = (item.attempts || 0) + 1;
    item.status = error?.permanent || item.attempts >= MAX_ATTEMPTS ? "blocked" : "pending";
    item.last_error = String(error?.message || error).slice(0, 300);
    await setLast({ok: false, event_id: eventId, error: item.last_error, status: item.status});
  }
  item.updated_at = Date.now();
  queue[eventId] = item;
  await saveQueue(queue);
}
async function retryAll() {
  const queue = await getQueue();
  for (const [eventId, item] of Object.entries(queue)) {
    if (["pending", "sending"].includes(item.status) && (item.attempts || 0) < MAX_ATTEMPTS) await deliver(eventId);
  }
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "RETRY_ALL") {
    retryAll().then(() => sendResponse({ok:true})).catch(e => sendResponse({ok:false,error:String(e)}));
    return true;
  }
  if (message?.type !== "QUEUE_X_POST") return;
  (async () => {
    const payload = message.payload || {};
    const username = normalizeUsername(payload.username);
    if (!payload.event_id || !payload.text || !username) throw new Error("Invalid X post payload");
    const cfg = await config();
    if (!cfg.squareApiKey) {
      await setLast({ok:false, status:"not_configured", error:"请先填写币安广场 OpenAPI Key"});
      sendResponse({ok:false, error:"not configured"});
      return;
    }
    if (cfg.enabled === false) {
      sendResponse({ok:false, error:"disabled"});
      return;
    }
    const bound = normalizeUsername(cfg.boundUsername);
    if (bound && bound !== username) {
      await setLast({ok:false, status:"account_mismatch", error:`扩展已绑定 @${bound}，忽略 @${username} 的推文`});
      sendResponse({ok:false, ignored:true});
      return;
    }
    if (!bound) await chrome.storage.local.set({boundUsername: username});
    payload.username = username;
    const queue = await getQueue();
    if (!queue[payload.event_id]) {
      queue[payload.event_id] = {payload, status:"pending", attempts:0, created_at:Date.now()};
      await saveQueue(queue);
    }
    await deliver(payload.event_id);
    sendResponse({ok:true});
  })().catch(error => sendResponse({ok:false, error:String(error?.message || error)}));
  return true;
});
chrome.runtime.onInstalled.addListener(async details => {
  await chrome.alarms.create(ALARM, {periodInMinutes: 1});
  const current = await chrome.storage.local.get(["enabled", "squareApiKey"]);
  if (typeof current.enabled !== "boolean") await chrome.storage.local.set({enabled:true});
  await updateBadge(await getQueue());
  if (details.reason === "install" && !current.squareApiKey) await chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => chrome.alarms.create(ALARM, {periodInMinutes: 1}));
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) retryAll(); });
