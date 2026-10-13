# 独立网页版修复移植

分支 `codex/web-optimizations` 基于 `main` 的 `578acb2`。仓库没有 `master`，远端默认分支为 `main`。修复来自插件分支 `feature/deepseek-harness-plugin`，逐项选择适用于独立网页版的内容，没有合并插件架构。

| 插件开发中发现的问题 | 独立网页版处理 |
| --- | --- |
| 消息发送人显示为未知 | 优先读取官方 `senderName`，兼容旧接口的名称字段及本人名称；文字、图片消息均覆盖测试 |
| 切换聊天时重复请求图片 | 移植图片内存缓存、并发请求合并、懒加载和淘汰规则；覆盖聊天图片、头像、引用、富文本及卡片图片 |
| 二维码图片加载失败缺少提示 | 移植图片加载错误处理，停止扫码轮询并提示重新获取；增加浏览器回归 |
| 二维码创建、读取与确认的会话一致性 | 独立版原有 Cookie 会话机制正确，保持实现；增加实际本机 HTTP 请求回归，验证三步共享会话及未知 Cookie 不能指定会话 ID |
| Harness 请求转发丢失 Content-Length | 独立网页直接请求 Python 服务，不经过该转发层；保留现有请求大小与上传校验 |
| 插件重载造成重复路由 | 独立版没有 Cordis 路由注册，不引入此逻辑 |
| Harness 切换菜单销毁 iframe | 独立版不使用 Harness 菜单和 iframe，不引入槽位保活及面板通信；保留已有前后台同步机制 |

启动脚本同时统一为默认直连，与 `python3 server.py` 一致。需要代理时显式设置 `YZJ_PROXY`，避免系统遗留代理地址影响本机启动。

## 图片缓存规则

缓存只保存在当前页面内存，最多 64 MiB / 128 项，5 分钟过期，按最近使用情况淘汰。单张超过 16 MiB 时使用原地址加载，不进入缓存；单个发送附件仍最多 32 MiB。媒体响应仍为 `no-store`，不新增图片的持久化存储。退出登录或登录过期会清空缓存，迟到的旧请求不能重新填入缓存。刷新页面后重新加载图片。

## 验证

```sh
python3 -m unittest discover -s tests -v
node --test tests/*.test.mjs
```

可选浏览器检查需要另行安装 Playwright，运行应用本身不需要 Node.js 或 Playwright：

```sh
PLAYWRIGHT_CHANNEL=chrome node tests/browser-web-cache.cjs
PLAYWRIGHT_CHANNEL=chrome node tests/browser-composer.cjs
```

浏览器检查使用虚构会话、消息和测试图片，拦截全部网络请求。验证两个聊天之间反复切换及原图预览只请求一次图片、名称和草稿保留、二维码加载失败恢复，以及原有 @ 成员、文件发送、截图裁剪和 Markdown 功能。不扫码或发送真实消息。

插件自动回复及其 Agent、工具、配置和运行生命周期仍保留在插件分支，后续继续在该分支开发。
