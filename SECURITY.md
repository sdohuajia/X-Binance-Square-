# Security

## Security properties

- Manifest V3.
- No remote JavaScript or `eval`.
- Explicit extension CSP: `script-src 'self'; object-src 'self'`.
- Incognito use disabled.
- Permissions limited to `storage` and `alarms`.
- Host access limited to X/Twitter and Binance.
- No clipboard, cookies, history, downloads, tabs, webRequest, debugger, nativeMessaging, identity, management, or broad `<all_urls>` permission.
- The MAIN-world hook returns immediately for requests whose URL does not contain `CreateTweet`; unrelated request bodies are not parsed.
- Replies and reposts are excluded. Media is not uploaded and media-only `t.co` tokens are removed.
- First detected X author is bound locally to avoid accidental cross-account posting. Binding can be reset explicitly.
- Queue deduplication uses the X post ID.

## Key handling

The Square OpenAPI key is destination-publishing authority and must be treated as a secret:

- stored only in `chrome.storage.local`;
- never hardcoded in source;
- never sent to a developer backend;
- never restored into an input element after saving;
- removable from the options page.

Chrome local extension storage is not a hardware-backed secret store. A compromised device, browser profile, extension process, or malicious extension with sufficient access can still expose local data. Use a Square-only publishing key with the narrowest available permissions; never enter a Binance trading API key.

## Reporting vulnerabilities

Do not include live keys, cookies, tokens, or account credentials in reports. Reproduce with dummy values and provide the affected version, browser version, and concise steps.
