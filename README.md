# X → Binance Square Auto Sync

![扩展图标](icons/icon-128.png)

通用 Chrome / Edge Manifest V3 扩展：用户在扩展设置页填写自己的**币安广场 OpenAPI Key**，之后从该桌面浏览器发布的新原创 X 推文会自动同步到用户自己的币安广场。

## 架构

```text
x.com CreateTweet 成功响应
  → MAIN world 页面钩子提取推文 ID、作者、最终文字
  → 隔离 content script 桥接
  → Manifest V3 service worker
  → 使用用户本地保存的 Square OpenAPI Key
  → 直接调用币安广场官方 content/add 接口
```

没有中心同步服务器，开发者不会收到或保存用户的币安密钥。

## 用户只需填写什么

只填写一个字段：**币安广场 OpenAPI Key**。不是币安现货/合约交易 API Key。

保存后输入框会立即清空，设置页以后只显示“已安全保存（内容已隐藏）”，不会把密钥重新写回页面 DOM。密钥只保存在 `chrome.storage.local`（不使用云同步），也可以随时删除。

X 用户名不需要填写：扩展第一次捕获成功发布的原创推文时自动绑定作者账号。用户可以在设置页重置绑定。

## 权限说明

- `storage`：本地保存 OpenAPI Key、绑定用户名、去重队列和状态。
- `alarms`：失败任务的定时重试。
- `https://x.com/*`、`https://twitter.com/*`：捕获浏览器自身成功的发推响应。
- `https://www.binance.com/*`：直接调用币安广场发布接口。

扩展不读取 X 密码、Cookie、私信或其他页面请求体。它不申请剪贴板、键盘、历史记录、下载、Cookie、标签页或 `<all_urls>` 权限；页面钩子只对 URL 含 `CreateTweet` 的成功发推响应进行解析。详见 [PRIVACY.md](PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。

## 开发验证

```bash
node --check page-hook.js
node --check bridge.js
node --check service-worker.js
node test-extension.js
node test-options.js
python3 audit_security.py
```

## 已知限制

- 只捕获从安装了扩展的桌面浏览器发布的推文。
- 手机 App 和其他浏览器发布的内容无法捕获。
- 只同步原创和引用推文的文字；不处理回复、转推、图片或视频。
- X 内部 GraphQL 响应结构改变时可能需要更新扩展。
- 若币安成功接收帖子但浏览器在收到响应前断网，自动重试理论上可能造成重复；币安当前发布接口未提供客户端幂等键。

## 开源许可

本项目采用 [MIT License](LICENSE)，允许使用、审计、修改和再分发。发行包不包含任何预置 API Key、私人账号、Webhook token 或开发者后端地址。

## 分发建议

可以直接分发 ZIP，让用户用开发者模式“加载已解压的扩展程序”。若要公开上架 Chrome Web Store，还需要补充图标、隐私政策、商店截图和权限用途说明，并按商店审核要求提交。
