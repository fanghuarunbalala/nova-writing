# GUI 与设计原型对齐计划（UI Prototype Alignment Plan）

## 1. 背景与目标

设计原型：`/Users/fanghuarun/index.html`（单文件 HTML，含完整布局、交互与
Novel Markup v1 渲染引擎）。目标：把当前 `ui/` + `gui/` 桌面端逐步对齐到该原型，
按"每步一个聚焦提交、不混 Runtime/Novel 轨道"的规程实施，前后端（core ↔ UI）
需要协同的改动在每一步里明确拆开。

当前基线：GUI 骨架（topbar/sidebar/main/inspector/overlays、对话列表、composer、
内容/计划视图、实体卡、大纲树、toast）已基本成型；GenStatus 已对齐。

## 2. 对齐基线

- 布局：topbar（wordmark + 计划/审批动作 + rev-meta）+ sidebar（创建对话、内容四 pane、
  对话列表、footing）+ main（chat/content/schedule）+ 右侧 inspector（审批/档案双 tab）。
- 消息：turn 分隔、user/assistant 结构、思考块、Novel Markup v1 正文、proposal 卡、
  运行时事件时序（evt-flow）+ 工具调用条（tool-strip）、生成状态。
- 右侧面板：审批队列 + Diff 详情（大纲/正文/实体字段分组、old-new、ins/del、evidence、
  批准并提交/请求修改/提交修改请求/note）、档案详情（在内容中定位）。
- 计划视图：统计、双状态轴、待办、大纲进度（含阻塞/搁置备注）。
- 视觉细节：滚动条、选区、焦点、入场动效、窄屏响应式（<1080/<920/<860）。

## 3. 全量差距清单（记录）

### 3.1 渲染 / Markdown（前端为主）

| 编号 | 缺口 | 原型 | 当前 | 归属 |
|---|---|---|---|---|
| M1 | 块级标题 | `<h1>/<h2>/<h3>`（nm-h1 下边框） | 仅标准 `#`；自定义标签字面显示 | 前端 |
| M2 | 表格 | `<table><row><cell>`，首行 th，圆角容器、无竖线、行 hover | 仅 GFM `\|`；样式为普通带竖线表格 | 前端 |
| M3 | 列表 | `<list><item>` | 仅标准 `-` | 前端 |
| M4 | 引用块 | `<quote>`（accent 左细线 + 楷体） | 仅标准 `>` | 前端 |
| M5 | 高亮 | `<hl>`（accent 底） | 无 | 前端 |
| M6 | 行内样式 | b/i/u/s/code（code 带边框底） | 有，code 样式不一致 | 前端 |
| M7 | 实体引用 | character/location/**chapter**/outline，成对或自闭合，`name=` 覆盖，未建档 **虚线 missing 态** | character/location/outline/paragraph，仅成对，无 name/无 missing | 前端 |
| M8 | 引用视觉 | 内联下划线可点击（.xr） | 胶囊 chip（MessageReferenceChip） | 前端 |
| M9 | 正文排版 | 15px/1.75/`text-wrap: pretty` | 有 15px/1.75，assistant 缺 pretty | 前端 |

### 3.2 对话时间线（前端为主，tool trace 需后端）

| 编号 | 缺口 | 说明 | 归属 |
|---|---|---|---|
| T1 | 结构化卡片未进时间线 | `chatSurfaceMapper` 硬编码 `cards: []`；卡片渲染器齐备但**投影器零注册** | 前端（投影器）+ 后端（确认事件 payload） |
| T2 | 运行时事件时序（evt-flow） | 原型"本轮时序"按 system/agent/novel 家族展示事件行；投影已有 `events` 描述（无 payload） | 前端（渲染）+ 后端（如需 payload 摘要） |
| T3 | 工具调用条（tool-strip） | 工具 chips 聚合展开（ok/time/行） | **后端**（投影增加 tool trace 摘要）+ 前端（渲染） |
| T4 | Turn 分隔符 | "第 N 轮 · 时间" | 前端（由 turns 投影派生） |
| T5 | 消息入场动效 | msg-in / conv-in 错峰 | 前端 |
| T6 | 引用点击未接线 | ChatSurface 未传 onMessageReferenceClick；chip 无行为 | 前端 |
| T7 | proposal 操作不完整 | 缺 批准/请求修改 + 状态 pill；onCardAction 无人接 | 前端（命令依赖 Step 4 后端） |
| T8 | approval-state 英文 | 显示 completed/failed；应为 已完成/已提交/生成失败 | 前端 |

### 3.3 审批面板（前后端）

| 编号 | 缺口 | 说明 | 归属 |
|---|---|---|---|
| A1 | 审批 API 面缺失 | core 有 NovelApprovalService/ChangeSetApproval/Bridge，但 NovelApiClient **无**审批查询/命令 | 后端 |
| A2 | 审批域 store 缺失 | shell 注释明确"approval 域延后"；InspectorHost 硬编码"审批面板待定" | 前端 |
| A3 | Inspector 双 tab 缺失 | 审批/档案 tab + count-pill | 前端 |
| A4 | Diff 详情缺失 | identity/legend/分组 diff/old-new/ins-del/evidence | 前端（数据来自 A1） |
| A5 | 批准/请求修改/note 流程 | 批准是事件、提交后才推进权威状态 | 后端命令 + 前端操作 |
| A6 | 顶栏审批 badge | 待审计数 | 前端（数据来自 A1） |

### 3.4 TopBar / 侧栏 / 主区（前端为主）

| 编号 | 缺口 | 说明 |
|---|---|---|
| H1 | 计划/审批动作按钮缺失 | 原型 topbar 有 计划/审批（badge） |
| H2 | wordmark 不一致 | Novel → OpenYourMind（或产品名定稿） |
| H3 | rev-meta / workspaceSub 未接线 | overview 已有 `sourceRevision`，ApplicationShell 未传 |
| H4 | 内容视图 sub-head 缺失 | 原型"← 返回对话"+标题+kicker；ContentSurface 无 sub-head |
| H5 | 对话行 pin/rename/delete 未接线 | 菜单空壳；**后端无对应 API**（会话仅 create/list/enqueue/subscribe/snapshot） |
| H6 | 对话时间恒 00:00 | catalog 无 lastActivityAt |
| H7 | 侧栏多"待办"组且顺序不同 | 原型：创建→内容→对话→footing |
| H8 | footer meta 显示 id | 应为 "r042 · 草稿 N 待审" |
| H9 | 模式名/空态文案 | 草案/直接执行/审批 vs 计划/直接执行/需审核；空态文案不同 |
| H10 | 响应式断点缺失 | 原型 <1080/<920/<860（抽屉化） |
| H11 | 滚动条/选区/焦点打磨 | 原型细滚动条 + accent 选区 + focus-visible |

## 4. 实施步骤（分步方案）

### Step 1：Markdown 与消息视觉对齐（纯前端）

范围：M1–M9、T5、T6、T8、H9、H11、H4。

- **决策点 D1（已确认 2026-08-06）**：方案 A 收敛版——保留 react-markdown 标准语法，
  **不做**完整白名单渲染器；只补 `<chapter>` 引用（character/location/outline/chapter/
  paragraph 五类），支持成对/自闭合/`name=` 覆盖；保留 paragraph 扩展；做 missing
  虚线下划线态（未建档 id → dotted + toast）。core prompt（novel.system）同步加入
  chapter 与自闭合/name 说明（已实现）。
- 前端改动（已实现）：extractReferenceTags / parseMessageText 五类标签解析、
  MessageReference 内联下划线样式（.xr 对齐）+ missing 态、ReferenceResolver
  （从域 store 解析档案名与 known）、ChatSurface 引用点击路由（character/location/
  outline → inspector；chapter/paragraph → 正文 pane 定位闪烁；missing → toast）、
  assistantMarkdown 标准 MD 视觉（表格圆角容器/引用块楷体/code 边框/标题/pretty）。
- 后续小项（已实现 2026-08-06）：ChatEmptyState 文案（新对话 + 创作引导）、
  ComposerModeBar 文案（计划/直接执行/需审核）、AssistantMessage 中文状态
  （生成中/已完成/已提交/已停止/生成失败，含 cancelled 映射）、消息入场错峰动效、
  ContentSurface/ScheduleSurface sub-head + back、TopBar 计划/审批按钮 + rev-meta
  （接 NovelOverviewStore.sourceRevision）、global.css 滚动条/选区/焦点。
- 验证：ui 单测（渲染器逐标签用例）+ `pnpm --dir ui check` + electron 目检。

### Step 2：结构化卡片管线接线（前端 + core 事件确认）

范围：T1、T7（命令部分延后到 Step 4）。

- 前端：实现并注册 card projectors（ConversationCardProjectorRegistry）：
  `novel.approval.requested` → proposal 卡（changeSetId/baseRevision/operationIds）；
  `agent.todo.updated` → plan 卡。将 ConversationProjectionBinding 升级为使用
  ConversationCardProjectionStore，`chatSurfaceMapper` 从卡投影填充 `cards`。
- 前端：`onProposalAction` 接线：view-diff → inspector 审批路由（Step 4 前为占位
  面板）；approve/reject 在 Step 4 前禁用或 toast。
- 后端：确认 `novel.approval.requested` / `agent.todo.updated` payload 序列化满足
  卡数据（预计无需 core 改动，只做契约核对）。
- 验证：ui 单测（投影→卡描述）、core 事件契约 smoke、electron 目检。

### Step 3：运行时事件时序与工具条（前后端）

范围：T2、T3、T4。

- 后端：projection 增加**脱敏 tool-trace 摘要**（从 system.tool.trace.recorded 投影：
  label 聚合、ok/failed、耗时、runId/turnId；不落 payload/参数）。
- 前端：新组件 `RuntimeEventFlow`（原型 .evt-flow：家族分色事件行 + 描述）与
  `ToolStrip`（tool chips 聚合展开）；timeline item 模型扩展 eventFlow/toolStrip；
  turn 分隔符组件（由 turns 投影派生"第 N 轮"）。
- 验证：core smoke（tool-trace 投影）+ ui 单测 + electron 目检。

### Step 4：审批面板（前后端，最大步）

范围：A1–A6、T7 命令部分。

- 后端：NovelApiClient 增加 approval 面：
  - 查询：`listPending(workspace/conversation)`、`getDetail(approvalRequestId)`（变更集
    ops + base/target + draftSessionId + digest + evidence）。
  - 命令：`approve(approvalRequestId)`、`requestChange(approvalRequestId, reason)`，
    复用 NovelApprovalService / NovelChangeSetApproval / ConversationNovelBinding
    的命令通道；批准通过 novel.approval.requested → resolve → commit 事件流落账。
- 前端：ApprovalStore（shell 域 store）+ hook；InspectorHost 双 tab + 待审列表 +
  Diff 详情（分组/old-new/ins-del/evidence）+ 操作区（批准并提交/请求修改/
  提交修改请求/note-box/resolved-banner）；ProposalCardRenderer 补操作；顶栏 badge
  接真实待审数；footer meta "r042 · 草稿 N 待审"。
- 验证：core approval API smoke + ui 单测 + electron 审批流 e2e 冒烟。

### Step 5：会话管理能力（后端，需确认 D2）

范围：H5、H6。

- 后端：conversation API 增加 rename/delete/pin 操作 + catalog 持久化 +
  lastActivityAt 时间戳投影。
- 前端：ConversationListSection 接线 onPin/onRename/onDelete；时间显示。
- 若 D2 决定本期不做，标记 deferred，菜单隐藏。

### Step 6：响应式与侧栏打磨（纯前端）

范围：H7、H8、H10。

- 前端：原型三断点（sidebar/inspector 抽屉化、窄屏隐藏 ws-name/rev-meta）；
  侧栏顺序对齐原型（待办组是否保留由 D3 定）；footer meta。

## 5. 待决策项

- **D1（已确认）**：方案 A 收敛——标准 Markdown + 五类引用（新增 chapter），不做完整
  白名单渲染器。
- **D2**：会话 rename/delete/pin 是否本期做（Step 5，需要后端 API）？不做则隐藏菜单。
- **D3**：侧栏"待办"组保留还是移除（原型侧栏无待办，待办在计划视图）。
- **D4**：wordmark 最终文案（OpenYourMind 还是保留 Novel）。

## 6. 不做范围（Out of scope）

- 原型中的多轮内部执行演示数据本身（c4）不作为产品数据，只用于验证 evt-flow 渲染。
- output-events-map.md 的全量 42 事件逐条 UI 化（以"能驱动关键状态与提示"为准，
  边缘事件仅保留日志/摘要）。
- 服务端/多人协作、权限模式设置面板（非本原型范围）。
