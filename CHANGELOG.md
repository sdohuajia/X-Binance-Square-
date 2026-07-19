# Changelog

## 1.2.4 — 2026-07-19

- When manually retrying rejected posts that contain links, asks for confirmation first.
- After confirmation, removes URLs and publishes only the remaining text.
- Shows how many rejected posts had their links removed and were resubmitted.
- Keeps the original captured text in local history; the sanitized text is used only for the retry request.

## 1.2.3 — 2026-07-19

- Displays an explicit “rejected by Binance” state for permanent publishing failures.
- Shows the Binance error code, rejection reason, timestamp, and a short post excerpt in the popup.
- Keeps the three most recent rejected records visible in the popup.
- Uses a red extension badge when blocked/rejected posts exist; orange remains reserved for retryable items.
- Escapes all remote error text before rendering it in the popup.

## 1.2.2 — 2026-07-19

- Preserves ordinary user links on the first Binance Square publishing attempt.
- If Binance explicitly rejects a URL with risk-control code `20041`, removes URLs and retries the same post once automatically.
- Shows a success note when links were removed by the fallback.
- Manual “retry now” can retry previously blocked queue items after an upgrade.
- Includes Binance error codes in status messages for easier diagnosis.

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
