# Changelog

## 1.2.1 — 2026-07-19

- Replaced the generic extension icon with the supplied yellow Binance mascot artwork.
- Added optimized 16, 32, 48, and 128 px icons using a face-focused crop for toolbar readability.

## 1.2.0 — 2026-07-19

- Open-source MIT release with privacy and security documentation.
- Saved Square OpenAPI keys are never restored into the options page DOM.
- Key input is cleared immediately after saving and only a configured/not-configured state remains visible.
- Unrelated X request bodies are skipped before parsing; only `CreateTweet` requests are inspected.
- Added explicit extension CSP and disabled incognito execution.
- Added static security audit covering permissions, clipboard APIs, remote code, private data, and key UI behavior.
- Media-only trailing `t.co` links are removed while ordinary user links remain intact.

## 1.1.x

- Added quote-post support, media text cleanup, local X-account binding, queue deduplication, and retries.
