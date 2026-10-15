# AI智能投递助手 · 浏览器扩展版

## 这是什么

这是一个 **MV3 浏览器扩展**：

| 文件 | 来源 | 说明 |
| --- | --- | --- |
| `boss.js` | 原文件 | 主程序注入脚本（**一字未改**） |
| `background.js` | 原文件 | 原有后台逻辑（**一字未改**） |
| `content-scripts/content.js` / `content.css` | 原文件 | 原有内容脚本与样式（**一字未改**） |
| `icons/` `_locales/` `assets/` | 原文件 | 图标 / 文案 / 样式（**一字未改**） |
| `ai-job-hunter.js` | 新增 | AI 投递助手主体脚本（由 `AI工作猎手.local.user.js` 自动生成） |
| `ai-job-hunter-shim.js` | 新增 | 主世界 GM_* 兼容层（网络 / 存储 / 通知桥接） |
| `content-scripts/ai-job-hunter-boot.js` | 新增 | 注入器：把上面两个脚本注入页面主世界 |
| `bg-wrapper.js` | 新增 | 后台入口：`importScripts` 依次加载 `background.js` + `net-bridge.js` |
| `net-bridge.js` | 新增 | 后台网络桥：跨域请求 / 二进制下载 / 系统通知 |
| `manifest.json` | 扩展配置 | 仅追加 1 条内容脚本 + 1 条 web_accessible_resources |

> 原有文件在构建时逐个做了 SHA256 校验，确保字节级未被修改。

## 安装（Edge / Chrome）

1. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`）
2. 打开左下角「开发人员模式」
3. 点击「加载解压缩的扩展」，选择本目录

## 构建

在工作目录执行：

```
python build_ext_r26.py
```

脚本会从 `AI工作猎手.local.user.js` 生成 `ai-job-hunter.js`，并重新组装
`ai-job-hunter-shim.js` / `ai-job-hunter-boot.js`，同时校验原有
原文件哈希未变。

## 工作原理

```
页面 (MAIN world)                     隔离世界 (ISOLATED)              后台 (SW)
┌────────────────────┐   CustomEvent   ┌──────────────────┐  runtime   ┌───────────────────┐
│ ai-job-hunter.js   │ ──────────────▶ │ boot.js          │ ─────────▶ │ bg-wrapper.js     │
│ ai-job-hunter-shim │ ◀────────────── │ (消息路由/注入)   │ ◀───────── │  ├ background.js  │
│ (GM_* 兼容层)       │                 │                  │            │  └ net-bridge.js  │
└────────────────────┘                 └──────────────────┘            └───────────────────┘
```

- **网络**：走后台上报，绕开页面 CORS 与「https 页面 → http 接口」的混合内容限制
- **存储**：真源 `chrome.storage.local`；`localStorage` 保留镜像供同步读取
- **通知**：`chrome.notifications`
- **界面**：与油猴版完全一致（同一份主脚本），并可同时使用原扩展自身界面
