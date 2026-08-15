# Changelog

版本号三个文件同步：`package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json`。
打 `v*` tag 时 GitHub Actions 自动构建 Windows 安装包并发布 draft release。

## [0.1.25] - 2026-08-15

### Fixes
- 侧边栏「项目」标题不再被挤到中间：标题行有 ▾ 箭头、文字、「＋」三个子元素，
  `justify-content: space-between` 会把中间的「项目」文字居中，而「任务」只有
  两个字元素所以靠左——两个标题一左一中看起来歪歪扭扭。改为左对齐 + 「＋」
  `margin-left: auto` 顶到最右，两个标题的「＋」现在水平对齐

## [0.1.24] - 2026-08-15

### Fixes
- 新对话里连发多条消息不再被拆成多个会话：原实现里空 tab 每次发消息都会先发
  `new_session`（tab 的 `sessionPath` 只有 `get_state` 才知道，而 pi 事件流不携带
  sessionFile，前端只在启动/切 tab 时查过）——结果一个对话发的第 2、3 条消息各自
  新建会话文件，每条消息都丢掉前面的上下文。现在 `new_session` 后立即 `get_state`
  学到会话文件并绑定到 tab（「＋」新建、首次发消息、切到空 tab 三条路径都覆盖），
  后续消息留在同一会话
- 新增 spike/e2e-sessionbind.mjs 回归（假 bridge + 脚本化两回合）：两次发消息只发
  一次 `new_session`、两次 prompt 落在同一会话文件、两条消息渲染在同一 tab，5 项
  断言（无修复时 3 项 FAIL）；另附 spike/probe-fixverify.mjs 真实 pi 探针：修复后
  流程两条消息只生成 1 个会话文件（2 条 user 消息）

## [0.1.23] - 2026-08-15

### Fixes
- 聊天区智能滚动不再漏掉「内容高度变化」：原实现只在消息计数变化时贴底滚动，
  而流式增量、思考块在 message_end 折叠、工具卡片更新、图片加载等都不改变计数——
  结果是回复在视口下方越长越多、思考块折叠后对话不自动跟进到底，只能手动下滑。
  改为 ResizeObserver 监听聊天内容高度，贴底（80px 阈值内）时自动跟随，
  「读旧消息不被拽走」的规则不变
- 新增 spike/e2e-scroll.mjs 回归（假 bridge + 脚本化长流式回合）：流式全程贴底、
  中途上滚不被拽回、思考块折叠后仍贴底，4 项断言

## [0.1.22] - 2026-08-15

### Fixes
- 模型选择器按「供应商 + 模型 id」唯一化：pi 的模型目录里同一 id 会出现在多个供应商下
  （实测 `deepseek-v4-flash` 同时存在于 deepseek / opencode-go / jbbtoken），旧代码用
  裸 id 当选项值导致同 id 的全部选项一起打勾、且点击非首个供应商条目时 `find()` 仍
  切到第一家。现在选项键为 `provider::id`、`setModel` 精确匹配双字段，勾选唯一、
  切换真实生效；触发器上同时显示当前供应商名
- 新增 spike/e2e-modelprovider.mjs 回归（对真实 pi 断言：菜单全表仅 1 个 ✓、
  切换 opencode-go 后 ✓ 移到对应分组且触发器显示该供应商）

## [0.1.21] - 2026-08-15

### Features
- 侧边栏「项目」模块支持整体折叠/展开：标题行整行可点击（左侧 ▾/▸ 箭头指示状态），
  折叠状态存 localStorage 重启保持；「＋」按钮与折叠动作解耦（点击不触发折叠）
- 「任务」标题右侧的「＋」与「项目」对齐：默认隐藏，悬停标题行才淡入（原先常显）
- 聊天区输入栏的项目选择器移除「添加项目…」入口——添加项目的唯一入口改为侧边栏
  「项目」标题右侧悬停浮现的「＋」（0.1.18 的对话框全流程原样复用）
- 会话搜索框移到侧边栏最顶部（两个模块标题之上，flex 固定不随滚动），过滤行为不变
- e2e-addproject.mjs 扩展断言：项目折叠/展开、任务标题 hover 浮现、聊天区菜单不再
  含「添加项目」；新增 spike/e2e-search-top.mjs 回归（搜索框位置 + 过滤仍生效）

## [0.1.20] - 2026-08-14

### Features
- 侧边栏「项目 / 任务」分区（ZCode/Codex 式）：
  - 顶部新增「项目」区块：列出最近项目，点击即切换（重启 pi）；当前项目标「当前」徽标
  - 区块头部右侧「＋」默认隐藏，悬停（或键盘聚焦）头部时淡入浮现——点击打开
    添加项目对话框（0.1.18 的输入路径 / 创建并添加 / 浏览… 全流程复用）
  - 原「会话历史」区块更名「任务」，与「项目」上下分区，滚动区归「任务」所有
- e2e-addproject.mjs 扩展侧边栏交互断言：分区结构、＋ 默认隐藏、CDP 真实鼠标
  悬停浮现、点击开对话框、点击项目项切换且「当前」徽标迁移

## [0.1.19] - 2026-08-14

### Features
- 侧栏会话列表按项目分组后只显示最近 5 条，其余折叠在「显示更多 (N)」按钮后面
  （Z-Code 式），再点变「收起」——项目里几十次对话不再淹没侧栏
  - 展开/收起状态存 localStorage，重启后保持；搜索模式不受影响（仍显示全部匹配）
  - 当前会话落在折叠区时该组自动展开（且不显示收起按钮，避免把活跃会话藏起来），
    刷新恢复会话后同样生效
  - 新增回归验证 `spike/e2e-sessionmore.mjs`（mock bridge + 真实 pi + headless
    Chrome，14 项断言全过：预览条数/切换/刷新持久化/自动展开）
  - mock-server 的 `/sessions` 对齐真实 `list_sessions`：按时间戳倒序 + 从会话头
    解析 uuid id（此前用文件名当 id，get_state 恢复会话时对不上）

## [0.1.18] - 2026-08-14

### Features
- 添加项目对话框（codex/opencode 式）：项目选择器菜单的「选择其他文件夹…」升级为
  「添加项目…」，打开对话框后可
  - 直接输入/粘贴文件夹绝对路径（300ms 防抖实时校验：存在 / 是文件 / 不存在）
  - 路径不存在时自动切换为「创建并添加」——输入新项目名即可建文件夹并切换
  - 「浏览…」仍走系统目录选择器；最近项目一键回填
  - 确认后切换工作目录并重启 pi（与既有 set_project 一致）
- 新增 Rust 命令 `project_path_info`（路径存在性/是否目录校验，WebView 无文件系统
  访问权限）与 `create_project_dir`（幂等建文件夹），均已注册并带单元测试
- 新增回归验证 `spike/e2e-addproject.mjs`（mock bridge + 真实 pi + headless Chrome，
  覆盖创建流程/文件路径拒绝/浏览回填/取消不切换，全程截图断言）

## [0.1.17] - 2026-08-14

### Fixed
- 会话标签/侧栏不再显示时间戳文件名（`2026-08-14T02-36-03-072Z_<uuid>.jsonl`）：
  pi 的 `get_state` 返回 `sessionName` 字段，前端误读 `d.name`（恒为 undefined），
  于是回退到会话文件 basename —— 每次打开应用恢复会话时标签都显示"当前时间"
  - 标签规则改为 Z-Code/OpenCode 式：真实名称 → 首条用户消息（preview）→
    中性占位名「新会话」；侧栏空会话显示「空会话」，文件名仅保留在悬浮提示里
  - 顺带修复 `sessionName` 字段读取，pi 侧重命名的会话现在能正确同步到标签
  - 新增回归验证 `spike/e2e-tablabels.mjs`（真实 pi + headless Chrome，6 项断言全过）

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
