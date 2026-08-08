# GUI 与设计原型差异修复清单（GUI Gap Backlog）

记录日期：2026-08-08。来源：对照 `vendor/index.html`（设计原型）与当前
`ui/` + `gui/` 桌面端逐项复查。编号沿用复查结论中的编号，与
`docs/ui-prototype-alignment-plan.md` 互为参照（本文件是待办执行清单，
对齐计划是历史步骤记录）。

状态说明：`open` 待修复 / `in-progress` 修复中 / `done` 已修复。

## 清单

### G2. 审批 Diff 与执行结果未实现（占位符）

- 状态：`done`（2026-08-08，前端）
- 现状：`ui/src/domains/approval/components/ApprovalPanel.tsx` 的大纲/
  正文/实体字段 Diff 区与执行结果区均为占位文案（"待生成"、
  "批准执行后生成 before → after"）。原型 `vendor/index.html:1546-1833`
  展示每个变更集的真实 before→after Diff（old-new、ins/del、evidence）。
- 方向：core 提供批准后变更 diff/执行摘要（写工具 describeOperation 结果），
  前端按原型分组渲染。依赖写工具执行轨道落地。
- 关联：对齐计划 A4 / Step 4。
- 实现记录：core 现仅提供操作摘要（`operations: {op,kind,id?,title?}`，无
  before→after 内容 diff、无执行结果载荷），故按 kind 把操作归入
  大纲/正文/实体字段 三个 diff 区渲染真实变更行（空组如实显示"本次无 X 变更"，
  不再伪造 before→after）；执行结果区按组状态显示决策/时间/actor。core 零改动。

### G3. 结构化卡片未接入时间线

- 状态：`open`
- 现状：`ui/src/shell/main/chatSurfaceMapper.ts:290-297` 的 `toTimelineCard()`
  对 generic 卡一律返回 `null`，无映射。六个卡片渲染器
  （`ui/src/domains/conversation/cards/`：text/proposal/diff/table/quote/plan）
  组件齐备但只在注册表里，diff/table/quote/plan 不会出现在消息里；
  时间线实际只渲染 ApprovalCard（tool-approval 时间线项路径）。
- 方向：确认 core generic 卡（ConversationCardDescriptor）当前有哪些 kind，
  为已存在 kind 补 projector → rich 卡映射；移除 `toTimelineCard` 的
  `default: return null` 空洞。
- 关联：对齐计划 T1。

### G4. 正文视图没有按章节分组

- 状态：`open`
- 现状：`ui/src/domains/novel/manuscript/store/ManuscriptStructureStore.ts:142-149`
  把所有段落合成单一章节 `__all_paragraphs__`（"全部段落"），原型
  `vendor/index.html:1890-1903` 按章节卡片展示（卷·章 + §块 + revision +
  草稿块）。块级 digest/draft/changeSetId 字段 core 暂未提供
  （`ManuscriptStructureStore.ts:13` 注释）。
- 方向：core 补齐章节/卷元数据契约；前端按章节分组渲染章节卡片。

### G5. 实体字段缺失（relatedUnits / locState / role）

- 状态：`open`
- 现状：
  - 角色/地点 `relatedUnits` 硬编码为空（`ui/src/domains/novel/character/store/CharacterStore.ts:143,155`、
    `ui/src/domains/novel/location/store/LocationStore.ts:145,160`），原型实体卡/详情卡
    有"关联故事单元"chips。
  - 地点 `locState` 硬编码 `"filed"`，原型有"草稿新增"态。
  - 角色 `role` 用 `aliases[0]` 占位。
- 方向：core 实体契约补 relatedUnits/locState/role 映射字段。

### G8. 正文草稿卡没有"前往审批 →"入口

- 状态：`open`
- 现状：`ui/src/domains/novel/manuscript/components/ManuscriptChapterList.tsx:15`
  的 `onOpenDraft` 是可选 prop 但未接线。原型 `vendor/index.html:1901`
  草稿章节卡底部有"前往审批 →"。
- 方向：正文视图草稿卡接 `onOpenDraft` → 打开审批面板选中对应变更集。

### G9. TopBar 注释与实现矛盾

- 状态：`done`（2026-08-08，前端）
- 现状：`ui/src/shell/topbar/TopBar.tsx:5-8` 注释声称"计划/审批入口已移除、
  审批占位无意义"，但 `ui/src/shell/ApplicationShell.tsx:403-413` 实际传入了
  `onOpenSchedule` / `onOpenApproval`，按钮在。注释过时误导。
- 方向：删除/改写 TopBar 顶部过时注释。
- 实现记录：注释改为如实描述右侧 计划/审批 动作 + 审批 badge（来自
  `ApprovalStore.pendingCount`）。单文件注释改动。

### G10. 侧栏差异：缺审批队列 section、多"待办"组

- 状态：`done`（2026-08-08，前端，决策 D3）
- 现状：`ui/src/shell/sidebar/Sidebar.tsx` 审批 section 被注释
  （"随 approval 域延后"）；待办组（`TodoSection`）在侧栏存在，但原型侧栏
  无待办（待办只在计划视图）。
- 方向：待审批 section 是否有价值由产品定（D3 遗留）；待办组保留/移除需决策。
- 实现记录：决策 D3 = 移除侧栏"待办"组（待办只留计划视图，与原型一致）；
  待审批队列仍走右侧审批面板（inspector），不加侧栏 section。
  `Sidebar` 移除 schedule/scheduleTodo/onTodoAction 三 prop 与 TodoSection；壳层
  与 sidebar 测试同步更新。

### G11. 计划视图 approval 类待办缺失

- 状态：`done`（2026-08-08，前端）
- 现状：`ui/src/domains/schedule/projection/ScheduleProjection.ts` 注释
  "approval 队列上游暂缺"；`ui/src/shell/ApplicationShell.tsx:206-215`
  `handleTodoAction` 只切 content 视图，不做定位。原型待办有"去审批"动作链接。
- 方向：审批域数据接入计划视图待办；todo action 增加打开审批面板/定位。
- 实现记录：`ScheduleProjection.deriveApprovalTodos()` 从 pending 审批快照派生
  审批类待办（`api.conversations.listApprovals()` 数据源）；`ScheduleSurface`
  订阅 `ApprovalStore` 并把审批待办并入列表；`handleTodoAction` 路由
  `open-approval` → `handleOpenApproval`（打开审批面板并选中）。core 零改动。

## 未列入本次修复（记录备查）

- G1 富文本方言（自定义 Novel Markup v1 vs 标准 Markdown）——对齐计划 D1
  已决策保留标准 Markdown，不做完整白名单渲染器，故不列入。
- G6 驳回备注输入框、G7 对话菜单原生 prompt/confirm、G12 文案
  （wordmark/label）——本期不修。
