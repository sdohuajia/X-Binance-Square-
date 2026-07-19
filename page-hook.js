/* Observe only X's successful CreateTweet response in the page context. */
(() => {
  if (window.__xSquarePublicHookInstalled) return;
  window.__xSquarePublicHookInstalled = true;

  function parseRequestBody(body) {
    try {
      if (typeof body === "string") return JSON.parse(body);
      if (body instanceof URLSearchParams) return JSON.parse(body.get("variables") || "{}");
    } catch (_) {}
    return {};
  }
  function variablesOf(payload) {
    return payload && typeof payload.variables === "object" ? payload.variables : payload;
  }
  function cleanText(tweet, vars) {
    let text = tweet.text;
    const requestHasMedia = Array.isArray(vars?.media?.media_entities) && vars.media.media_entities.length > 0;
    const responseMediaUrls = [...new Set(tweet.mediaUrls || [])];
    if (!requestHasMedia && responseMediaUrls.length === 0) return text;
    for (const url of responseMediaUrls) text = text.split(url).join("");
    if (requestHasMedia && responseMediaUrls.length === 0) {
      text = text.replace(/\s+https:\/\/t\.co\/[A-Za-z0-9]+\s*$/, "");
    }
    return text.trim();
  }
  function isSyncable(vars) {
    // Replies remain excluded. Quote posts are synchronized as text.
    const replyId = vars?.reply?.in_reply_to_tweet_id || vars?.in_reply_to_tweet_id;
    return !replyId;
  }
  function findCreatedTweet(root, wantedText) {
    const seen = new Set();
    let fallback = null;
    function walk(value) {
      if (!value || typeof value !== "object" || seen.has(value)) return null;
      seen.add(value);
      const legacy = value.legacy;
      if (value.rest_id && legacy && typeof legacy.full_text === "string") {
        const username = value.core?.user_results?.result?.legacy?.screen_name ||
          value.core?.user_results?.result?.core?.screen_name || "";
        const mediaUrls = [
          ...(legacy.extended_entities?.media || []),
          ...(legacy.entities?.media || [])
        ].map(item => item?.url).filter(Boolean);
        const candidate = {id: String(value.rest_id), text: legacy.full_text, username, mediaUrls};
        if (wantedText && legacy.full_text === wantedText) return candidate;
        if (!fallback) fallback = candidate;
      }
      for (const child of Object.values(value)) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    }
    return walk(root) || fallback;
  }
  function emit(url, requestPayload, response) {
    try {
      if (!String(url).includes("CreateTweet") || !response?.ok) return;
      const vars = variablesOf(requestPayload || {});
      if (!isSyncable(vars)) return;
      response.clone().json().then(data => {
        const tweet = findCreatedTweet(data, vars?.tweet_text || "");
        if (!tweet?.id || !tweet?.text || !tweet?.username) return;
        window.postMessage({
          source: "x-square-public-hook",
          type: "X_ORIGINAL_POST_CREATED",
          payload: {
            event_id: `x:${tweet.id}`,
            tweet_id: tweet.id,
            username: tweet.username,
            text: cleanText(tweet, vars),
            source_url: `https://x.com/${tweet.username}/status/${tweet.id}`
          }
        }, window.location.origin);
      }).catch(() => {});
    } catch (_) {}
  }

  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    const url = typeof input === "string" ? input : input?.url;
    if (!String(url).includes("CreateTweet")) {
      return originalFetch.apply(this, arguments);
    }
    const body = init?.body ?? (typeof input === "object" ? input?.body : undefined);
    const payload = parseRequestBody(body);
    return originalFetch.apply(this, arguments).then(response => {
      emit(url, payload, response);
      return response;
    });
  };

  const XHR = window.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function(method, url) {
      this.__xSquareUrl = url;
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function(body) {
      if (!String(this.__xSquareUrl).includes("CreateTweet")) {
        return send.apply(this, arguments);
      }
      const payload = parseRequestBody(body);
      this.addEventListener("load", function() {
        if (!String(this.__xSquareUrl).includes("CreateTweet") || this.status < 200 || this.status >= 300) return;
        const vars = variablesOf(payload || {});
        if (!isSyncable(vars)) return;
        try {
          const tweet = findCreatedTweet(JSON.parse(this.responseText), vars?.tweet_text || "");
          if (!tweet?.id || !tweet?.text || !tweet?.username) return;
          window.postMessage({
            source: "x-square-public-hook",
            type: "X_ORIGINAL_POST_CREATED",
            payload: {
              event_id: `x:${tweet.id}`,
              tweet_id: tweet.id,
              username: tweet.username,
              text: cleanText(tweet, vars),
              source_url: `https://x.com/${tweet.username}/status/${tweet.id}`
            }
          }, window.location.origin);
        } catch (_) {}
      });
      return send.apply(this, arguments);
    };
  }
})();
