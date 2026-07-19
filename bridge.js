(() => {
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (message?.source !== "x-square-public-hook" || message?.type !== "X_ORIGINAL_POST_CREATED") return;
    const payload = message.payload;
    if (!payload || typeof payload.text !== "string" || typeof payload.event_id !== "string") return;
    chrome.runtime.sendMessage({type: "QUEUE_X_POST", payload}).catch(() => {});
  });
})();
