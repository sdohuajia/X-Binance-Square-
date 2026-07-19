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
  const unfinished = Object.values(queue).filter(x => x.status !== "published");
  const blocked = unfinished.some(x => x.status === "blocked");
  await chrome.action.setBadgeText({text: unfinished.length ? String(unfinished.length) : ""});
  await chrome.action.setBadgeBackgroundColor({color: blocked ? "#B42318" : unfinished.length ? "#D97706" : "#16A34A"});
}
async function setLast(value) {
  await chrome.storage.local.set({lastStatus: {...value, at: Date.now()}});
}
function normalizeUsername(value) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase();
}
function stripUrls(text) {
  return String(text || "")
    .replace(/https?:\/\/[^\s]+/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
async function publishOnce(text, apiKey) {
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
  if (!response.ok) {
    const error = new Error(`Binance HTTP ${response.status}`);
    error.code = `HTTP_${response.status}`;
    throw error;
  }
  if (String(payload.code) !== "000000") {
    const code = String(payload.code || "unknown");
    const error = new Error(`${payload.message || "Binance rejected the post"} (code ${code})`);
    error.code = code;
    error.permanent = !["10004"].includes(code);
    throw error;
  }
  const id = String(payload.data?.id || "");
  if (!id) throw new Error("Binance returned success without a post ID");
  return {id, url: `https://www.binance.com/square/post/${id}`};
}
async function publish(text, apiKey) {
  try {
    return await publishOnce(text, apiKey);
  } catch (error) {
    // Binance Square may reject otherwise valid posts with code 20041 when a
    // URL is considered risky. Preserve links on the first attempt; only when
    // Binance explicitly rejects them do we remove URLs and retry once.
    if (error?.code !== "20041") throw error;
    const withoutUrls = stripUrls(text);
    if (!withoutUrls || withoutUrls === text.trim()) throw error;
    const result = await publishOnce(withoutUrls, apiKey);
    return {...result, links_removed: true};
  }
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
    const textToPublish = item.retry_text || item.payload.text;
    const result = item.retry_without_links
      ? await publishOnce(textToPublish, cfg.squareApiKey)
      : await publish(textToPublish, cfg.squareApiKey);
    item.status = "published";
    item.square_id = result.id;
    item.square_url = result.url;
    item.links_removed = Boolean(result.links_removed || item.retry_without_links);
    item.last_error = "";
    await setLast({ok: true, event_id: eventId, square_url: result.url, username: item.payload.username, links_removed: item.links_removed});
  } catch (error) {
    item.attempts = (item.attempts || 0) + 1;
    item.status = error?.permanent || item.attempts >= MAX_ATTEMPTS ? "blocked" : "pending";
    item.last_error = String(error?.message || error).slice(0, 300);
    item.error_code = String(error?.code || "unknown");
    item.rejected_at = Date.now();
    await setLast({ok: false, event_id: eventId, error: item.last_error, error_code: item.error_code, status: item.status, username: item.payload.username});
  }
  item.updated_at = Date.now();
  queue[eventId] = item;
  await saveQueue(queue);
}
async function retryAll(forceBlocked = false, removeLinks = false) {
  const queue = await getQueue();
  let linksRemoved = 0;
  let skippedEmpty = 0;
  for (const [eventId, item] of Object.entries(queue)) {
    if (forceBlocked && item.status === "blocked") {
      if (removeLinks) {
        const original = String(item.payload?.text || "").trim();
        const cleaned = stripUrls(original);
        if (cleaned !== original) {
          if (!cleaned) {
            skippedEmpty++;
            continue;
          }
          item.retry_text = cleaned;
          item.retry_without_links = true;
          linksRemoved++;
        }
      }
      item.status = "pending";
      item.attempts = 0;
      queue[eventId] = item;
      await saveQueue(queue);
    }
    if (["pending", "sending"].includes(item.status) && (item.attempts || 0) < MAX_ATTEMPTS) await deliver(eventId);
  }
  return {links_removed_count: linksRemoved, skipped_empty_count: skippedEmpty};
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "RETRY_ALL" || message?.type === "RETRY_WITHOUT_LINKS") {
    retryAll(true, message.type === "RETRY_WITHOUT_LINKS")
      .then(result => sendResponse({ok:true, ...result}))
      .catch(e => sendResponse({ok:false,error:String(e)}));
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
