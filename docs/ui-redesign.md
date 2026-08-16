# Pi Desktop UI 重设计：Codex 外壳 × zcode 正文

> 状态：**已实施（v2 定稿版）**· 方向已确认（融合 / 深色单主题 / **保留现有配色**）
> 基线：原为 opencode TUI 皮肤（peach `#fab283` + violet `#9d7cd8` 双强调色、全局等宽）
> 对照截图（实施后新截图已覆盖旧基线）：`spike/e2e-1-empty.png`、`spike/e2e-2-usage.png`、`spike/project/*.png`
>
> **v2 变更（用户决定）**：配色一律保留——peach/violet 双强调色就是品牌，
> 不做"单一强调色"替换。改的是结构：字体分工、布局、正文排版、状态条。
>
> **v3 变更（用户实测反馈）**：模型/思考选择器**回到输入框发送键左边**（原
> 布局不动），底部状态条只保留用量统计 + 连接点（纯遥测）；侧边栏「项目/
> 任务」标题严格对齐——v3.1 起两个标题**都无前导标记**（去掉项目折叠箭头，
> 折叠功能保留在标题点击 + tooltip），同边距同内边距。
>
> **实施记录（2025-08-15）**：P1–P5 全部完成，`npm run build` 通过；
> e2e 回归 10/10 全绿（smoke / modelprovider / tablabels / sessionmore /
> search-top / addproject / dragregion / project / sessionbind / scroll）。
> 顺带修复了三个随历史重构过期的 e2e 断言（smoke 的 `.assistant` 后代选择、
> modelprovider 的 `.inputbox .inputbox-select`、project 的 `.topbar .project-select`
> 与 `.status-state`、addproject 无涉）。v3 调整后 e2e 复跑全绿。

## 1. 设计立场（一句话）

**外壳取 Codex App 的安静结构，正文取 zcode 的终端质感**——这是一个"你在终端里发话、agent 像 Codex 一样作答"的双语会话界面。

### 参照物拆解

| 维度 | Codex App（2025 版） | zcode（终端 agent） | 本项目取 |
|---|---|---|---|
| 字体 | 无衬线为主，等宽仅代码 | 全等宽 | 外壳无衬线 / 用户行+工具行+状态条等宽 |
| 强调色 | 单一、极克制 | ANSI 多色但低饱和 | 单一靛蓝 `#7C8CF8` |
| 会话正文 | 散文式，assistant 带模型名头注 | `>` 提示符、括号式工具行 | 双轨制（见 §5） |
| 工具调用 | 单行可展开条目 | `[bash] $ cmd` 紧凑行 | 单行工具条目（去卡片化） |
| 会话元信息 | 每条回复尾部 model · tokens · cost | 底部状态条常驻计数 | 两者都要：头注 + 底部状态条 |
| 输入框 | 极简圆角框 + 发送箭头 | `>` + 斜杠命令 | 极简框 + `>` 保留终端身份 |
| 留白 | 慷慨、居中窄列 ~760px | 密集 | 居中 760px 列 |
| **配色** | **单一克制强调色** | **ANSI 低饱和** | **保留 opencode peach/violet 双色（品牌）** |

### 签名设计（唯一记忆点）

**双轨排版**：用户消息 = 等宽终端提示行（`>` 前缀 + mono），assistant 回复 = 无衬线散文（带模型名头注 + 思考胶囊）。同一屏内两种参照物各司其职，不做成"又一个 opencode 换皮"，也不做成"又一个普通聊天软件"。

**配色身份（v2 起）**：peach `#fab283` = 交互主色（`>` 提示符、caret、发送键、活跃态、连接 OK），violet `#9d7cd8` = 思考/头注/标题/选中态。双色分工明确，不混用、不加第三种高饱和色。

## 2. Token 系统

### 2.1 颜色（深色单主题，保留 opencode 调色板）

**不换色**——现有 `:root` 变量全部保留（peach/violet 即品牌），只明确双色分工：

```css
/* 保留（现状不变） */
--bg: #0a0a0a;  --bg-panel: #141414;  --bg-element: #1e1e1e;
--bg-hover: #282828;  --bg-active: #323232;
--border: #3c3c3c;  --border-strong: #484848;  --border-active: #606060;
--text: #eeeeee;  --text-dim: #a0a0a0;  --text-faint: #808080;
--accent: #fab283;      /* peach — 交互主色：> 提示符 / caret / 发送 / 活跃态 / 连接点 */
--accent-2: #9d7cd8;    /* violet — 思考 / 头注 / 标题 / 选中 */
--secondary: #5c9cf5;   /* blue — 模型名 / 运行中工具 */
--ok: #7fd88f;  --err: #e06c75;  --warn: #f5a742;  --info: #56b6c2;  --yellow: #e5c07b;
```

分工规则：**peach 管"我发出动作"（提示符、发送、进行中），violet 管"agent 的思考与结构"（思考块、标题、选中态）**，蓝色 `--secondary` 只用于模型名与运行中工具。不加第四种高饱和色。

### 2.2 字体

```css
--sans: 'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
--mono: 'Cascadia Code', 'JetBrains Mono', Consolas, 'Courier New', monospace;
```

| 角色 | 字体 | 字号 |
|---|---|---|
| 界面标签 / 侧边栏 / 顶栏 | sans | 11–12.5px |
| 用户消息 / 工具行 / 状态条 / 代码 | mono | 12–13.5px |
| assistant 正文 | sans | 14px，行高 1.7 |
| 代码块内 | mono | 12.5px |

### 2.3 圆角与层级

| 元素 | 值 |
|---|---|
| 输入框 / 工具条目 / 菜单 | 10px / 6px / 8px |
| 模态框 / 空态卡 | 12px |
| 选中态 | 左侧 2px accent 竖条（侧边栏），不用整行边框 |

### 2.4 布局（grid 不变，底部新增一行）

```
grid-template-columns: 236px 1fr;
grid-template-rows: 40px 1fr auto 28px;
grid-template-areas:
  'sidebar topbar'
  'sidebar chat'
  'sidebar input'
  'status  status';        /* 状态条横贯全宽，含侧边栏之下 */
```

## 3. 组件级改造清单

### 3.1 `theme.css`（结构换皮，颜色不动）

- 调色板原样保留；`--sans` 加入；body 默认字体改 sans（外壳无衬线化）
- `.chat` 内边距 `24px 32px` → `28px 44px`，`.chat-inner` / `.inputbox` max-width `860px` → `760px`
- 新增 `.statusbar` 样式 + grid 增加 `status` 行（28px，横贯全宽）
- 滚动条 10px → 8px，thumb `--bg-active`
- 删除 peach/violet 残留 → 不需要，颜色全保留；只把 peach/violet 按 §2.1 分工归位（`>`、caret、发送、活跃态 = peach；思考、标题、选中 = violet）
- `.md h1..h4` 保持 violet（品牌），不动

### 3.2 `Message.tsx` — 双轨排版（签名落地）

- **user 行**：保持 `>` + 等宽，字号 13.5px；去掉 baseline 对齐改为 flex-start
- **assistant 行**新增头注（新 CSS `.turn-head`）：
  ```
  [● 8px 状态点] deepseek-v4-flash · 思考▸ · ¥0.01    （11px faint，sans）
  ```
  头注内元素：模型名（info 蓝）· 思考胶囊（折叠时显示）· 成本（右侧）
- **思考块**：`details` 改为胶囊行 `▸ 思考过`（accent 三角，折叠态一行）；展开后正文 `--bg-panel` + 左侧 2px `--accent-soft` 边框，12.5px dim 文本；streaming 中默认展开（现有行为保留）
- **流式文本**：末段 plain pre-wrap + 8px accent caret（保留）
- **msg-meta**：模型 · tokens · ¥ 移到头注右侧；无头注时不显示重复信息

### 3.3 `ToolCard.tsx` → 工具条目（去卡片化）

- 样式：单行（高 34px），`border: 1px solid var(--border)`，radius 6px，背景透明
- 行内：8px 状态点（running=info 脉冲 / done=ok / error=err）· 工具名（mono 12px，text）· 参数（dim，ellipsis）· 右侧状态词（RUNNING/DONE/ERROR，10px letterspacing）
- 展开区：点行展开输出，`--bg-panel`，mono 11.5px，pre-wrap，max-height 280px，顶部 1px hairline
- 删除现有 header hover 整行变亮 + 边框色变化的重型样式

### 3.4 新增 `StatusBar.tsx`（zcode 签名落地，纯遥测）

横贯底部 28px 高、mono 11px、`--bg-panel` + 顶部 1px border：

```
右: ↑12k ↓3k R1.2k W800 CH42% ¥0.42 · ● 已连接
```

- 模型 / 思考选择器**不在状态条**（v3：回到输入框，见 §3.5）
- 连接点复用 `.conn-dot`；用量统计（`computeSessionUsage`）从原输入框 hint 行迁到这里

### 3.5 `InputBar.tsx` — 收敛但不挪选择器（v3 定稿）

- 面板结构保留：📁 项目 chip 行 + `>` + textarea + **⚡思考级 + 模型选择器 + 发送键**（v3：选择器回到发送键左边，维持用户习惯的布局）
- 发送按钮：`→` 字符按钮，peach 底、`#1a0f0a` 文字，圆形 28px（codex 式）；disabled 时 30% 透明；agent 运行时原位变「■ 停止」
- placeholder「输入消息…」faint；textarea 改 sans 14px（打字手感像 codex，终端身份由 `>` 提示符承担）
- 底部 hint 行保留，右对齐，字号 10.5px（用量统计已迁走）

### 3.6 `Sidebar.tsx` — 结构不动，换皮

- section 标题改 sans 10px uppercase + letterspacing 0.14em（现状已是，换色即可）
- 「项目/任务」标题严格对齐（v3.1）：两个标题**都无前导标记**（去掉项目折叠
  箭头，折叠功能保留在标题点击 + tooltip），同 margin/padding，标签零偏移
- 活跃会话：`--bg-element` + 左侧 2px accent 竖条（`border-left`，radius 0），替代整行 border
- 项目行 / 会话组 / 显示更多 / 悬停浮现＋：颜色换新 token，其余不动

### 3.7 `TopBar.tsx` / 空态 / 安装错误屏

- logo 块：保留 peach π 方块（品牌）；名称 faint
- 空态：π 46px peach，「有什么可以帮你？」sans 15px，hint 10.5px
- 安装/错误卡：新 palette 不动（颜色保留），accent 按钮保持现有样式

## 4. 交互细则

- 悬停：`--bg-hover`，过渡 0.1s；工具条目悬停仅行背景微亮，不整卡变亮
- 焦点：`:focus-visible` peach 1px outline（保留）；输入框 focus-within 边框 peach
- 选中：`rgba(157, 124, 216, 0.35)`（violet，保留）
- 滚动：贴底跟随逻辑（ResizeObserver）不动，只换样式
- 键盘：Ctrl+N/W/1-9 不动；输入框 Enter/Shift+Enter/IME 逻辑不动

## 5. 排版规范（正文细则）

```
> 帮我重构登录模块                                    ← mono 13.5，> 为 accent
                                                    
deepseek-v4-flash · 思考过▸ · ¥0.01                 ← sans 11 faint 头注
好的，我来分析一下。                                ← sans 14 正文
                                                    
▸ read src/login.tsx                                ← mono 工具条目行
▸ edit src/login.tsx ✓                              ← 完成后状态点变绿
                                                    
[DONE] bash: npm test · 12 passed                   ← 展开后的工具输出
```

规则：
1. 用户话永远等宽（你在"终端"里）
2. agent 话永远无衬线（它像"App"一样回答）
3. 工具与代码永远等宽
4. 头注是每个 assistant turn 的第一行，模型名唯一彩色（`--secondary` 蓝）
5. 分隔：turn 之间 `margin-bottom 20px`，不加横线（codex 式呼吸感）

## 6. 实施阶段与验证

| 阶段 | 内容 | 验证 |
|---|---|---|
| P1 | theme.css 结构换皮（sans 外壳/布局列宽/状态条行，颜色不动） | `npm run build` + 应用截图全量对比 |
| P2 | 双轨排版 + 工具条目（Message/ToolCard） | 真实会话截图（含 thinking/流式/工具） |
| P3 | StatusBar 新增 + InputBar 收敛 | 布局截图 + 状态条选择器交互 |
| P4 | Sidebar/TopBar/空态/安装错误屏换皮 | 截图对比 |
| P5 | 回归：`spike/e2e-*.mjs` 全量跑 + 手测快捷键/IME | e2e 全绿 |

每个阶段独立可提交；P1 完成即整体气质成型，后续是细节。

## 7. 不做（Non-goals）

- 不做浅色主题（双主题以后再说，需要双 token + 持久化）
- 不做布局重构（236px 侧栏、标签页结构、grid 保留）
- 不加新功能（斜杠命令、会话分组改动、建议卡片——空态建议卡片可作 P6 候选，未定）
- 不改 Rust 端（纯前端改动）
- 不 bump 版本 / 不打 tag

## 8. 待确认的开放项（实施前敲定）

1. 空态是否加 3 个建议 chip（写代码 / 解释代码 / 修 bug，点击填入输入框）—— 倾向做，P6
2. 状态条是否含项目名 chip（与输入框内 📁 chip 二选一）—— 倾向输入框保留
3. 工具条目展开默认态：running 自动展开（现状）还是全折叠 —— 倾向保留现状
