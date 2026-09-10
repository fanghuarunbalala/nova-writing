# shell 组合层

把 5 个域拼成可见表面（spec 4）。壳不持有业务状态，只做路由 + 组合 + 副作用协调。

## 结构

- `ApplicationShell.tsx` — 组合根（由 `app/NovelApp.tsx` 统一组装注入）
- `topbar/` — 顶栏：workspace 标识 + 视图切换 + 动作
- `sidebar/` — 新建/对话/待办/footing sections（审批 section 随 approval 域）
- `main/` — 主区路由：Chat / Content（四 tab）/ Schedule
- `inspector/` — 路由式右侧面板：entity / outlineUnit / conversation（approval 占位）
- `overlays/` — ToastHost + 弹窗槽位

## 副作用协调（唯一允许跨域触发的地方）

workspace 切换 effect 并行触发各域 `loadWorkspace`；内容选中联动
`InspectorRouter.transition`。
