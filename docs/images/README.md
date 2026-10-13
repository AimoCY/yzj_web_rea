# 界面预览图

这些 PNG 展示项目当前 HTML/CSS/JavaScript 渲染的实际界面。数据全部由 `scripts/capture-previews.cjs` 人工构造，不读取正在运行的服务、不复用用户浏览器会话，也不连接云之家。

- `chat-desktop.png`：桌面聊天列表和对话内容。
- `image-queue.png`：选择两张人工生成的 PNG 后的发送队列；仅展示，不执行真实发送。
- `chat-mobile.png`：窄屏对话布局。

联系人、群聊、发送者和当前用户名称均为虚构值，姓名与群名区域额外使用不透明色块遮挡。头像用条纹块替换，图片内容为代码生成的插画或仓库测试夹具。遮挡已经渲染到 PNG 中，不是可以移除的网页遮罩层。截图带有“脱敏演示 · 虚构数据”标记。

## 重新生成

应用运行不需要 Playwright；以下工具仅用于维护文档截图。需要 Node.js 和 Playwright：

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node scripts/capture-previews.cjs
```

如果本机已有 Google Chrome，可以跳过下载 Chromium，在 macOS / Linux 执行：

```sh
PLAYWRIGHT_CHANNEL=chrome node scripts/capture-previews.cjs
```

脚本使用全新的浏览器上下文，拦截预览地址的所有网络请求并返回固定虚构数据；其他服务地址一律阻断。预览地址使用本机回环域名，但不需要启动 HTTP 服务。请勿将脚本改为访问真实服务后直接提交截图。
