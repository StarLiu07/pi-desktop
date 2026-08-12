# Changelog

版本号三个文件同步：`package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json`。
打 `v*` tag 时 GitHub Actions 自动构建 Windows 安装包并发布 draft release。

## [0.1.6] - 2026-08-12

### UX
- 思考过程块在流式输出期间默认展开，实时可见；结束后恢复可折叠

## [0.1.5] - 2026-08-12

### Fixed
- 新建会话时先 abort 当前运行的 agent（pi 同一时刻只处理一个 agent，
  之前在新标签发消息会静默打断旧会话）
- toolResult 文本递归提取：嵌套 content 数组不再显示 `[object Object]`

### Features
- 会话历史新增搜索框（按名称/文件名过滤）
- 会话时间显示改为相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前）

## [0.1.4] - 2026-08-12

### Fixed
- 中文输入法（IME）按 Enter 确认候选词不再误发送消息（`isComposing` 检查）

### Features
- 模型下拉按提供商分组（optgroup），几十个模型不再难找
- 代码块悬停显示一键复制按钮
- 多模态消息图片渲染（data URL / 路径）

## [0.1.3] - 2026-08-12

### Features
- 键盘快捷键：Ctrl+N 新建会话、Ctrl+W 关闭、Ctrl+1…9 切换标签
- 窗口标题跟随活动会话名
- assistant 消息底部显示模型名 + token 用量 + 成本（消息结束后）
- 设置弹窗新增：版本号、快捷键说明、pi stderr 日志查看器（滚动 500 行）
- 输入框自动聚焦，切换标签后聚焦回输入框

### UX
- 聊天区智能滚动：只有贴近底部时才跟随新内容，读历史不再被拽回
- ToolCard 参数 JSON 截断（>240 字符），完整内容在 tooltip

### Performance
- Vite 手动分包：markdown/highlight 与 tauri 依赖拆出主 bundle（567KB → 206KB）

## [0.1.2] - 2026-08-12

### Fixed
- RPC 请求增加 30s 超时：pi 进程崩溃/卡死时不再永久悬挂，pending map 不再泄漏
- `turn_end` 携带的 `toolResults` 现在会追加到消息流（此前工具结果消息可能丢失）
- `agent_end` 的完整消息快照用于对账 UI 与 pi 的最终状态（重试/回滚后不再漂移）
- `prompt` 发送失败时回滚乐观的用户文本，不再残留
- 关闭运行中的标签页会先 `abort`，agent 不再在后台继续跑
- 消息列表改用稳定 key（responseId / toolCallId），快照替换不再导致全量重挂载
- `pi_exit` 时清空所有 in-flight RPC 解析器
- 会话列表按会话时间戳排序（此前按 UUID 文件名排序）

### Performance
- `find_pi_entry` 结果缓存（命中即缓存，未命中不缓存以支持安装后重试）——
  `npm root -g` 探测约 200ms，此前每次启动检查都会执行
- ToolCard 参数 JSON 截断显示（>240 字符），完整内容保留在 tooltip
