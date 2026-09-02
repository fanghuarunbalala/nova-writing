# conversation 域

用户与 Novel Agent 交互的主入口（spec 3.1）。

## 结构

- `store/` — `ConversationCatalogStore`（列表/选中/新建/重试，rename/delete/pin
  待 core 契约扩展）、`ComposerDraftStore`（本地草稿：文本/模式/引用）
- `projection/` — 纯数据模型：`ConversationTimelineItem`、`AssistantDraftProjection`
  （delta 累积 + terminal）、`ConversationCardDescriptor`（RichText 节点树）
- `cards/` — 卡片渲染器注册表 + text/proposal/diff/table/quote/plan 六个默认 renderer
- `hooks/` — `useConversationCatalog` / `useComposerDraft` /
  `useConversationProjection`（桥接 core binding）/ `useConversationRuntimeStatus`
- `components/` — 时间线（>200 条窗口化虚拟化）、消息、思考块、提案块、
  composer、对话列表/菜单等 16 个组件

## 约定

- store 用 `ExternalStore`，快照不可变；并发操作经 `TaskSerializer`
- 组件只消费域内类型；跨域联动（审批等）经 shell 协调
