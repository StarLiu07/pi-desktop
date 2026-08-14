# Changelog

版本号三个文件同步：`package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json`。
打 `v*` tag 时 GitHub Actions 自动构建 Windows 安装包并发布 draft release。

## [0.1.16] - 2026-08-14

### Fixed
- 顶栏无法拖动窗口（0.1.15 无边框回归）：`data-tauri-drag-region="false"` 误加在
  整条 `.tab-strip`（`flex: 1` 占满顶栏中段）上，tauri drag.js 的 `"false"` 语义会
  封禁该元素及其所有祖先 —— 整条标题栏只剩 π logo 可拖
  - 改为仅每个 `.tab` 个体标记 `"false"`（保持点击/双击重命名），标签间空隙恢复可拖，
    双击空隙仍可最大化；验证装置 `spike/e2e-dragregion.mjs`（注入真实 drag.js +
    CDP 真实鼠标事件，拖/不拖矩阵 6 项全过）

## [0.1.15] - 2026-08-14

### Features
- 无边框一体化窗口（OpenCode/ZCode 风格）：去除 Windows 系统标题栏，整窗深色一体
  - `decorations: false`，顶栏承担标题栏角色：顶栏/全屏页整体为拖动区域
    （`data-tauri-drag-region="deep"`），双击顶栏最大化
  - 自绘窗口控制三键（最小化 / 最大化·还原 / 关闭），opencode 风格：顶栏右侧 +
    安装/连接失败全屏页右上角；关闭按钮悬停红色
  - 新增 `WindowControls` 组件，标签/按钮区标记不可拖（`"false"`），交互不受影响

### Fixed
- 会话名写入窗口标题此前被 Tauri ACL 静默拒绝（缺 `allow-set-title` 权限），现已授权

### Changed
- capabilities 追加窗口控制权限：`allow-minimize` / `allow-toggle-maximize` /
  `allow-close` / `allow-start-dragging` / `allow-set-title`

## [0.1.14] - 2026-08-14

### Fixed
- 启动黑窗口全面修复：窗口就绪后显示（load + 双 rAF）、连接中骨架屏、npm 探测静默化
  （改路径直探 + `CREATE_NO_WINDOW`，不再弹 Windows Terminal）
- Markdown 渲染改懒加载（拆包，减少首屏体积）

## [0.1.13] - 2026-08-13

### Features
- 底部输入面板一体化（ZCode 风格）：项目选择器、思考强度、模型选择器全部并入输入面板
  - 项目选择器从顶栏移入输入面板顶部工具行，与输入框共用一个圆角边框
  - 模型/思考强度选择器移至输入行内、发送键左侧（⚡ 强度 + 模型名），原底部状态栏移除
- 侧边栏会话分组可折叠：点击项目分组标题（📁）折叠/展开其下会话，折叠状态持久化于
  localStorage（`pi-desktop.sidebar.collapsed`），重启后保持

### Changed
- 移除侧边栏「✨ AI 命名」批量命名按钮（新会话首轮后自动命名 `maybeAutoNameActiveSession` 保留）

## [0.1.12] - 2026-08-13

### Features
- 项目（工作目录）功能，参考 ZCode/Codex：顶栏 logo 旁新增项目选择器
  - 项目 = pi 子进程的工作目录：切换项目即带新 `cwd` 重启 pi，
    bash/read/write 工具与 `AGENTS.md`/`CLAUDE.md` 加载随之切换
  - 「选择其他文件夹…」调起原生目录选择对话框（rfd）
  - **「无项目」模式**：菜单顶部选项，对话不绑定任何文件夹
    （pi 以默认 cwd 运行，`set_project` 传空目录即清除 current，
    最近项目保留、一键可切回）
  - 最近项目持久化于 `%APPDATA%/pi-desktop/projects.json`（最多 8 个，
    已删除的目录自动清理），菜单中一键切换
  - 侧边栏会话按项目（会话头记录的 `cwd`）分组展示，当前项目组置顶并标注「当前」；
    其余组按组内最近会话时间倒序，旧会话不再被名字排序埋没
- 重启 pi 期间 `pi_exit` 不再误报连接中断（新增 `restarting` 状态，重试连接同样受益）

## [0.1.11] - 2026-08-13

### UX
- 状态栏模型/思考强度切换重做（参考 opencode 底栏 + codex 弹出面板风格）：
  - 去掉原生 `<select>` 与「思考」「模型」标签，改为紧凑的 value-first 触发器
    `⚡ high ▾` / `DeepSeek V4 Flash ▾`
  - 自定义弹出菜单：向上弹出、按 provider 分组、当前项 peach ✓ 标记、
    中文等级释义（关闭/极少/…/最大）、Esc/方向键/回车键盘操作、点击外部关闭
  - 思考强度按当前模型能力适配：`reasoning: false` 的模型（图像模型等）控件禁用；
    有 `thinkingLevelMap` 的模型（deepseek 系）菜单中不支持的等级置灰并标注
    「当前模型不支持」

## [0.1.10] - 2026-08-13

### UX
- 应用/任务栏图标重绘：暗色圆角方底 + 官方 Pi 标识（peach 强调色），
  几何直接取自 pi.dev 的 logo SVG；`tauri icon` 重新生成全套尺寸
  （源文件 `src-tauri/icons/icon-source.png` + `make-icon.py`，可复现）

## [0.1.9] - 2026-08-13

### Features
- 会话 AI 命名：新会话首轮对话结束自动生成标题；侧边栏「✨ AI 命名」一键为
  历史会话批量生成名字（复用 pi 默认模型 deepseek-v4-flash 及现有提供商配置，
  经 Node helper 走 pi 的 ModelRuntime；未命名会话先显示首条消息预览，不再是一串
  时间戳文件名）
- 会话名解析与 pi 一致：取最新一条 `session_info`（重命名后历史列表立即同步）

### Fixed
- 历史会话点击后加载不出消息（两处根因）：
  - 直接追加进会话文件的 `session_info` 记录必须带 `parentId`（链到当前叶子
    记录的 id），否则会断开 pi 的消息上下文链，`get_messages` 返回空
  - `openSessionFromHistory` 预先设置 `activeTabIndex` 导致 `activateTab` 的
    "已在同一会话"守卫误判，`switch_session` / `get_messages` 被跳过

## [0.1.8] - 2026-08-13

### Features
- 输入框下方新增会话用量统计行（与 pi CLI footer 一致）：`↑` 输入 token / `↓` 输出
  token / `R` 缓存读取 / `W` 缓存写入 / `CH` 缓存命中率（取最新一条回复）/ `¥` 使用
  金额（实时汇率 USD→CNY，失败回退 7.2）。每轮对话结束自动累计更新，历史会话同样适用；
  金额与 token 数字格式化逐项对齐 pi CLI（spike/ 下新增 mock bridge 装置可脱离
  Tauri 做浏览器端 E2E 冒烟测试）

## [0.1.7] - 2026-08-13

### Fixed
- 历史会话加载：桌面版之前的 pi CLI 会话（`~/.pi/agent/sessions`）不再"消失"——
  刷新历史时自动按文件名去重同步进桌面会话目录（幂等、不覆盖已有文件，
  尊重 `PI_CODING_AGENT_SESSION_DIR` / `PI_CODING_AGENT_DIR` 环境变量），
  之后 CLI 新建的会话也会自动出现

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
