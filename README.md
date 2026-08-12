# Pi Desktop

**Pi Desktop** 是 [Pi 编码代理](https://pi.dev)（`@earendil-works/pi-coding-agent`）的桌面前端，交互与视觉灵感来自 [opencode](https://opencode.ai)。

不重写 agent：桌面版是 Pi 的第二个前端，通过 pi 自带的 **RPC 模式**（`pi --mode rpc`，JSONL over stdio）复用完整的 agent 能力——15+ 提供商、工具调用、思考、会话、扩展全部照常工作。

## 功能

- 🗂️ 多会话标签页：新建 / 切换 / 关闭 / 从历史树打开（快捷键 Ctrl+N / Ctrl+W / Ctrl+1…9）
- 💬 流式对话：markdown + GFM + 代码高亮（代码块一键复制），思考过程可折叠
- 🛠️ 工具调用可视化：read / write / edit / bash 卡片，实时输出与状态
- 🤖 模型切换：`get_available_models` 全量列表按提供商分组，底部状态栏即选即用
- 🧠 思考等级切换：off / minimal / low / medium / high / xhigh / max
- 🛑 随时中止当前回合（`abort`）
- 📊 assistant 消息尾部显示模型 / token 用量 / 成本
- 🖼️ 多模态消息图片渲染（data URL / 路径）
- 🔍 设置弹窗内置 pi stderr 日志查看器，诊断不求人
- ⚙️ 暗色终端主题，会话独立存储（`%APPDATA%\pi-desktop\sessions`），刷新历史时自动把 pi CLI 时期的历史会话（`~/.pi/agent/sessions`）同步进来

> 注：中文输入法（IME）下按 Enter 确认候选词不会误发送消息。

## 架构

```
React + Vite 前端（Tauri WebView）
   │  Tauri IPC（invoke / event）
Rust 核心（src-tauri/src/pi.rs）
   │  spawn 子进程 + JSONL stdio
pi CLI（--mode rpc）            ← npm 全局包
   │
LLM 提供商（DeepSeek / Anthropic / OpenAI / Ollama …）
```

事件流（来自 pi 0.83.0 实测校准，见 `spike/`）：

```
agent_start → turn_start → message_start(user)
           → message_start(assistant) → message_update*（text/thinking/toolcall 增量）
           → tool_execution_start / update* / end（工具卡片）
           → message_end(assistant) → turn_end（toolResults）
           → agent_end → agent_settled
```

## 开发环境

- Node.js ≥ 20（pi CLI 由 Node 运行）
- Rust 工具链（Windows 下需 mingw-w64 gcc 或 MSVC）
- pi CLI：`npm install -g @earendil-works/pi-coding-agent`

## 运行

```bash
npm install
npm run tauri dev      # 开发模式
npm run tauri build    # 打包安装包
```

> 找不到 pi 时应用内会显示安装指引；也可用环境变量 `PI_DESKTOP_PI_ENTRY`
> 直接指定 pi 的 `dist/cli.js` 路径。

## 目录结构

```
src/             React 前端
  rpc/           协议类型（types.ts）+ Tauri 桥（bridge.ts）
  store/         zustand 状态机：事件流 → 会话标签页/消息/工具卡片
  components/    TabBar / Sidebar / ChatView / ToolCard / InputBar …
  styles/        暗色终端主题
src-tauri/       Rust 后端
  src/pi.rs      RPC 桥：子进程管理、JSONL 解析、事件转发、会话列表
spike/           协议探针（校准 RPC 类型定义用的真实输出）
```

## 协议备注（踩坑记录）

- `switch_session` 的 `sessionPath` 必须是**绝对路径**——传文件名会被解析为
  pi 进程 cwd 下的相对路径，导致加载空会话
- `new_session` 后，第一次 `prompt` 才真正创建会话文件
- `message_update` 事件自带完整消息快照（`message` 字段），直接用快照渲染，
  无需手工累积 delta
- 会话列表没有 RPC 命令，由 Rust 直接扫描会话存储目录（`*.jsonl`）；
  扫描前会把 pi CLI 的会话（`~/.pi/agent/sessions/**`，同样尊重
  `PI_CODING_AGENT_SESSION_DIR` / `PI_CODING_AGENT_DIR` 环境变量）按文件名
  去重复制进桌面会话目录，幂等且不覆盖已有文件
- `fork` 的 `entryId` 必须是**最后一条 user 消息**的 id（assistant 回复的 id
  会报 `Invalid entry ID for forking`）；`get_messages` 返回的消息不带 id，
  因此由 Rust 解析会话文件提供
- Windows 下 `npm` 是 `npm.cmd`，`Command::new("npm")` 会失败——必须按平台
  指定 `npm.cmd`
