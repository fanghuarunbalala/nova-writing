# workspace 域

当前 workspace 上下文根（spec 3.4）。

- `store/WorkspaceControllerAdapter.ts` — 把现有 WorkspaceController 桥接到
  `ExternalStore`（快照镜像 + refresh 透传；动作仍由原 controller 执行）
- `hooks/useWorkspaceControllerSnapshot.ts`
- `components/` — WorkspaceFooting / WorkspaceLabel / WorkspaceRevisionMeta

`WorkspaceMetadataStore` 待 core workspace metadata API（spec §11 范围外）落地。
