# Changelog

版本号三个文件同步：`package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json`。
打 `v*` tag 时 GitHub Actions 自动构建 Windows 安装包并发布 draft release。

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
