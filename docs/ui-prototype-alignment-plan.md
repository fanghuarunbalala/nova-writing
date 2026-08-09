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

**现状核对（2026-08-06 代码确认）**：binding 已用 `ConversationCardProjectionStore`
且 `ConversationProjectionBindingSnapshot` 已含 `cards`（generic 描述：
cardId/kind/title/summary/status/sourceSequence）；`useConversationProjection` 已支持
`cardProjectors` 选项；rich 渲染器（Proposal/Plan/Diff/Table/Quote/Text）已注册并
接线进 `AssistantMessage.cards`。**缺的只是：没有 projector 注册（cards 恒空）、
mapper 硬编码 `cards: []`、`onProposalAction` 无人接。**

**core 侧（预计零改动）**：`novel.approval.requested` payload 已注册 schema
（requestVersion/approvalRequestId/novelId/draftSessionId/baseRevision/
changeSetDigest/operationIds），前端可从事件 payload 读取。注意：事件只有
operationIds，**没有 op 明细**（新增哪块/改哪个字段），所以本步 proposal 卡只带
标题/meta/changeSetId，ops 留空；op 明细等 Step 4 审批详情 API。

**前端改动（文件级）**：
1. 新 projector：`ui/src/domains/conversation/cards/projectors/novelApprovalCardProjector.ts`
   - eventType `novel.approval.requested` → generic 卡：
     `cardId = payload.approvalRequestId`、`kind = "approval"`、
     `title = "变更提议"`、`summary = base {baseRevision} → 待提交 · N 个操作`、
     `status = "pending"`。
   - 注册工厂 `createDefaultConversationCardProjectorRegistry()`（预留 task projector 插槽）。
2. `ChatSurface`：useMemo 创建默认 registry 传入 `useConversationProjection`；
   mapper 改为 `mapProjectionTimeline(snapshot.projection, snapshot.cards.cards, label)`；
   新增 `onProposalAction` prop 传给 ConversationTimeline。
3. `chatSurfaceMapper`：接受 cards；assistant 消息按
   `startedSequence ≤ sourceSequence ≤ lastSequence` 归属；generic → rich 映射：
   `approval → { kind: "proposal", content: { tag: "proposal", title, meta: summary,
   changeSetId: cardId, ops: [] } }`；其余 kind 暂跳过。
4. `MainArea` / `ApplicationShell`：`onProposalAction` 接线——view-diff →
   `inspectorRouter.transition({ kind: "approval", changeSetId })`；
   approve/reject → toast "审批操作将在审批域接入后可用"。
5. 测试：projector 单测（伪造事件 → 卡描述）、mapper 归属边界单测、
   ChatSurface onProposalAction 回调。
6. 验证：core smoke（approval 事件 schema）+ ui test/check + electron 目检
   （真实一轮生成 → proposal 卡出现，点"前往审批 Diff"打开右侧占位面板）。

**决策点/风险**：proposal 卡标题事件里没有，Step 2 用固定"变更提议"，Step 4 审批
详情 API 后可替换；空 ops 只保留"前往审批 Diff"入口；多 approval 事件天然按
sequence 归属不同消息，无去重问题。

**实现记录（2026-08-06）**：已提交 `feat: wire proposal cards from approval events`。
新增 `cards/projectors/novelApprovalCardProjector.ts` 与注册工厂；ChatSurface 注入
默认 registry 并传 `snapshot.cards` 给 mapper；mapper 按 sourceSequence 归属并把
approval 卡映射为 rich proposal 卡（tag proposal / changeSetId / ops 空）；
`onProposalAction` 接线（view-diff → inspector approval 路由，approve/reject →
toast）。core 零改动；`smoke:novel-approval` 通过；ui 200 测试全绿。

### Step 3：运行时事件时序与工具条（前后端）

范围：T2、T3、T4。

- 后端（已实现 2026-08-06，提交 `feat: add redacted event summaries and tool-trace
  projection`）：`ConversationEventDescriptor` 增加脱敏 `summary`（
  `ConversationEventSummary.ts` 按事件类型从 payload 取 id/状态/计数/修订号，
  不落正文/prompt/参数）；`ConversationProjectionSnapshot` 增加 `toolTraces`
  （从 system.tool.trace.recorded 投影：toolName/outcome/durationMs/runId/turnId/
  sequence）。投影 store smoke 扩展断言（含"摘要不得泄漏正文"）。
- 前端（已实现，提交 `feat: render runtime event flow, tool strip and turn
  separators`）：timeline item 新增 `turn`（第 N 轮 · 时间）与 assistant 的
  `eventFlow`/`toolTraces`；新组件 `RuntimeEventFlow`（家族分色、默认折叠）与
  `ToolStrip`（工具聚合 chips 展开行）；mapper 按 sequence 归属事件与 trace。
- 验证：core smoke + ui 单测 + electron 目检。

### Step 4：审批面板（前后端，最大步）

范围：A1–A6、T7 命令部分。

**重要对齐（2026-08-06）**：本步设计必须与已确认的
`docs/novel-write-approval-plan.md`（决策 1A/2A/3A/4A）一致——审批是**写前审批**
（写工具 permission `ask` → ToolApprovalRequest 带操作 diff 摘要 → 批准后单事务
落库），**删除** draft/commit/rebase 与 novel approval 服务。因此：
- **不用** novel.approval.requested 桥（当前未接线，且会被删除）；数据源用
  对话投影已有的 `ToolApprovalProjection`（title/description/status/actorId/
  requestedAt/resolvedAt/argumentDigest/toolName）。
- 决策走已有 `ApprovalDecisionInputEvent`（command.tool.approval.decision），
  UI 通过 conversation.input.enqueue 发送，core 无需新命令 API。
- diff 详情 = 写工具 `describeOperation` 挂到 approval summary 的
  title/description（依赖另一个轨道 P4 落地）；面板展示操作摘要 + 工具名 +
  argumentDigest + 状态时间。

**core 侧**：
- 前置依赖另一个轨道 P1–P6（写工具真实执行 + 摘要）；本步 core 改动预计很小：
  确认 ToolApprovalProjection 字段足够；可选扩展 ApprovalDecisionPayload 增加
  reason 字段（原型"请求修改+说明"，当前只有 approved/rejected）。

**前端改动**：
1. `ApprovalStore`（从 binding projection.approvals 派生 pending/resolved 列表）。
2. InspectorHost 双 tab（审批/档案）：审批 tab = 待审列表（count-pill）+ 详情
   （identity/toolName/摘要/状态/时间）+ 操作（批准 / 拒绝=请求修改 →
   enqueue ApprovalDecisionInputEvent）；resolved 显示 resolved-banner。
3. 卡片投影切换：Step 2 的 novel.approval.requested projector 改为
   system.tool.approval.requested → 工具审批卡（title/summary/approvalRequestId），
   卡上"批准/拒绝"直接决策；ProposalCardRenderer 复用或新建 ToolApprovalCardRenderer。
4. 顶栏审批 badge 接真实 pending 数；footer meta "r042 · N 待审"。
5. Timeline 里 system "等待审批" 行升级为可点击打开面板。

**待确认**：① 请求修改 reason 是否本期扩 payload（否→先二元决策）；② Step 2 的
novel.approval.requested 投影是否删除（新架构下不再产生该事件）。

验证：core smoke（审批决策输入→投影 resolved）+ ui 单测 + electron 审批流 e2e。

**实现记录（2026-08-06）**：已提交 `feat: add approval panel, tool approval cards and
decision actions`（决策 ①先二元、②删除 novel 投影）。core 零改动：
- 新 `ApprovalStore`（shell 级）：从投影 `ToolApprovalProjection` 派生待审/已决 +
  决策回调（ChatSurface 注入，enqueue `ApprovalDecisionInputEvent`）。
- InspectorHost 双 tab（审批/档案）+ ApprovalPanel（待审列表 count-pill、详情、
  批准/拒绝、resolved banner）。
- 卡片投影器切换：novel.approval.requested → `system.tool.approval.requested`
  （title/description 来自写工具 describeOperation 摘要）；proposal 卡补
  批准/请求修改按钮；时间线"等待审批"行可点击打开面板。
- TopBar badge 接 pendingCount；footer meta "r042 · N 待审"。

### Step 5：会话管理能力（后端，需确认 D2）

范围：H5、H6。

- 后端（已实现 2026-08-06，D2 确认本期做）：conversation API 增加
  `rename / pin / delete` 操作 + catalog 持久化（title/pinned 列，migration v6）；
  `lastActivityAt` 由 metadata.updatedAt 提供。
- 前端（已实现）：ConversationCatalogStore 增加 rename/pin/delete 动作；
  ConversationListSection 接线菜单（重命名用 prompt、置顶、删除）与时间显示；
  置顶排序优先。

### Step 6：响应式与侧栏打磨（纯前端）

范围：H7、H8、H10。

- 前端：原型三断点（sidebar/inspector 抽屉化、窄屏隐藏 ws-name/rev-meta）；
  侧栏顺序对齐原型（待办组是否保留由 D3 定）；footer meta。

**实现记录（2026-08-09）**：本步已由 v2 原型对齐分支完成（见 §7.3）——inspector
三断点 + 审批抽屉化落地；侧栏顺序对齐；footer 因决策 3 删除。

## 5. 待决策项

- **D1（已确认）**：方案 A 收敛——标准 Markdown + 五类引用（新增 chapter），不做完整
  白名单渲染器。
- **D2（已确认）**：会话 rename/delete/pin 本期做（Step 5，已实现）。
- **D3（已确认）**：侧栏"待办"组移除（待办只在计划视图；v2 原型无侧栏待办）。
- **D4（已确认）**：wordmark 保留 Novel（见 §7.1 决策 1）。

## 6. 不做范围（Out of scope）

- 原型中的多轮内部执行演示数据本身（c4）不作为产品数据，只用于验证 evt-flow 渲染。
- output-events-map.md 的全量 42 事件逐条 UI 化（以"能驱动关键状态与提示"为准，
  边缘事件仅保留日志/摘要）。
- 服务端/多人协作、权限模式设置面板（非本原型范围）。

## 7. v2 原型对齐（c7a7c29 视觉换代 · 2026-08-09，分支 `feat/ui-prototype-alignment`）

`vendor/index.html` 在 commit `c7a7c29`（657+/541-）做了一次视觉精修换代
（"OpenYourMind · 雾港回声｜创作工作台"）。本分支把 `ui/` React 实现对齐到新原型，
按"每步一个聚焦提交"实施，共 6 个提交（C1–C5 + 本文档 C6）。每步验证
`pnpm --dir ui test && pnpm --dir ui check` 全绿；C1 额外 `pnpm --dir gui build`。

### 7.1 已确认决策（旧待决策项终态）

| 项 | 决策 | 说明 |
|---|---|---|
| 决策 1 · wordmark | **保留 Novel**（旧 D4 终态） | 不动文本；可视情况对齐渐变流动动画 |
| 决策 2 · 执行模式 | **保留 ui/ 三模式**（compose 设计·仅草稿文件可写 / bypass 直接执行 / review 需审核） | **不**改成原型的「计划」语义；仅做下拉面板结构 + 图标 |
| 决策 3 · 侧栏 footer | **删除** WorkspaceFootingSection | 对齐原型（无 side-foot） |
| 决策 4 · 正文排版 | **全面对齐** | `--font-body` 改衬线（Iowan Old Style + 宋体/思源宋体）、新增 `--font-ui`、`--font-display` 英文优先、全局基线 13.5px→15px |
| 旧 D2 | 会话 rename/pin/delete 已实现（Step 5） | 终态：已做 |
| 旧 D3 | 侧栏"待办"组 | 终态：移除（待办只在计划视图，v2 无侧栏待办） |

### 7.2 提交范围（对齐点 → 文件）

**C1 · 布局基础：Composer 悬浮化（`211367f`）**
- `.composer` 绝对定位贴底、透明底 pointer-events none、form 内 auto；GenStatus 与
  ComposerModeBar 移入 form 内（`padding:8px 8px 10px 15px`、radius 16px、shadow-1）。
- ChatSurface `.surface{position:relative}` + `::before` 底部 120px 渐变遮罩；
  `.timeline{padding:8px 22px 132px}`；`.inner{max-width:880px;margin:0 auto}`。
- tokens：`--shadow-2` 改原型双层值；新增 `--font-ui`；`--font-body` 改衬线栈；
  `--font-display` 英文优先。global.css：body font-family → `--font-ui`、基线 15px。

**C2 · 消息视觉（`11942ec`）**
- UserMessage：删 Avatar/head，`flex-direction:row-reverse` 贴右、气泡 `16px` 圆角
  `text-align:left` 去边框；新增复制按钮（默认隐藏、hover 显形、`::before` hover bridge、
  `inPad` 首条收进气泡带）+ toast「已复制消息」。
- AssistantMessage：删 Avatar，head 只留 approval-state；补 `.stopped`/`.rejected` 状态色。
- turn-sep：label 改纯时间（`chatSurfaceMapper` 去「第 N 轮」前缀）；渐变线 + 间距。

**C3 · Composer 控件（`4a1f4b3`）**
- ComposerModeBar 重构为下拉浮窗（trigger + options 从发送框上方浮出、外部点击/Escape
  关闭、aria-expanded/role=menu、三枚 16×16 SVG 图标、`m-ico` 随当前模式变色）。
- GenStatus 扁平化：去边框/底色，三点呼吸动画 `.gen-dots i`（错峰 .22s/.44s）。

**C4 · 侧栏/顶栏（`f5c14a1`）**
- ContentSection 内容项新增 20×20 stroke-1.7 内联 SVG 图标（大纲/正文/人物/地点）；
  `.item` 视觉微调（gap 12px、padding 6.5px 10px、font-size 15px）。
- 删除 WorkspaceFootingSection（决策 3）；Sidebar 界面字段保留兼容注释。

**C5 · 审批面板 + Inspector 响应式（`c3cef4c`）**
- InspectorHost 恒挂载：closed 时 aside 仍在 DOM（aria-hidden + inert + margin-right
  收起过渡），内容 gate；宽度改 `--insp-w` 驱动（tokens 新增 `--insp-w:860px`，移除旧
  `--inspector-width-*`），媒体查询 ≤1280/≤1080/861-1200(clamp)/≤860(fixed drawer)，
  拖拽写 inline `--insp-w`（仅拖过才写，clamp 沿用原型 JS：minW 560/340、maxW
  `min(1120,vw-520)`、≤860 不拖）。
- ApprovalPanel：删悬浮预览（.apprHover）与内部标识（.id/.csId/◈ 不可变）；目录按对话
  分组（.apprGroup + 对话名 + .agJump「跳转」）；diff 标题中文化（大纲变更/正文变更/
  实体变更）、`.opKind` 中文（大纲/正文/人物）；新增 props
  onJumpToConversation/drawerOpen/onToggleDrawer，窄面板（@container ≤600px）目录折叠
  为左侧滑出抽屉，选中条目自动收起。
- ApplicationShell 复用 `handleSelectConversation` 作 onJumpToConversation；kicker
  「审批参数 · 变更集不可变，批准执行后才产出差异」。

### 7.3 响应式断点实现记录（旧 Step 6 关闭）

原型三断点已落地于 InspectorHost：
- `≤1280`：`--insp-w:720px`；`≤1080`：`--insp-w:640px`。
- `861–1200`：流式右列 `clamp(380px, 46vw, 560px)`（移除旧 `<640` 纵向叠砌）。
- `≤860`：inspector 固定抽屉滑出（`position:fixed; transform:translateX(102%)`，
  拖拽手柄隐藏），开合走 transform 过渡。
- 审批面板内部：`@container (max-width:600px)` 目录折叠为左侧滑出抽屉
  （`.listToggle` + `.scrim` + `.list` absolute）。
侧栏顺序（创建→内容→对话）在 Step 1 已对齐；footer 因决策 3 删除，无 footer meta。

### 7.4 术语中文化（本分支覆盖项）

- ApprovalPanel diff 区标题（大纲变更/正文变更/实体变更）、`.opKind`（大纲/正文/人物）、
  kicker（「审批参数 · 变更集不可变，批准执行后才产出差异」）。
- 遗留（非本分支范围）：事件名逐一中文化、Diff「完整参数」字段级中文标签等，留待后续
  迭代，不影响本期对齐验收。
