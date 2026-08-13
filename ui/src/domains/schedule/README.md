# schedule 域

聚合视图（spec 3.5）：不持有独立数据源，派生自
`NovelOverviewStore` + `StoryOutlineTreeStore` + `ConversationCatalogStore`。

## 结构

- `projection/` — `ScheduleProjection`：stats / todos / progressTree（纯函数）
- `store/` — `ScheduleStore`（订阅上游 + deep-equal 复用快照）、`ScheduleTodoStore`（勾选态）
- `hooks/` — overview / todos / progress 三个订阅 hook
- `components/` — 统计行、双轴流程、待办列表、进度树等

## 约定

- 上游 error 传播为自身 error phase
- approval 类 todo 待 approval 域落地后补充（依赖注入为可选）
