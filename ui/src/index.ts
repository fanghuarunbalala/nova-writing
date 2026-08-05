/** Shared React bindings and presentation primitives for GUI and Web clients. */
export * from "./app/index.js";
export * from "./card/index.js";
export * from "./client/index.js";
export * from "./command/index.js";
export * from "./composer/index.js";
export * from "./conversation/index.js";
export * from "./extensions/index.js";
export * from "./inspector/index.js";
export * from "./navigation/index.js";
export * from "./novel/index.js";
export * from "./outline/index.js";
export * from "./platform/index.js";
export * from "./review/index.js";
export * from "./settings/index.js";
export * from "./shell/index.js";
export * from "./state/index.js";
export * from "./theme/index.js";
export * from "./workspace/index.js";

/* ===== 新架构（spec 前端架构设计）===== */
// 以命名空间导出，避免与 legacy 同名导出（outline/workspace/inspector/shell）
// 冲突；最终迁移删除 legacy 后改为扁平导出。
export * as domains from "./domains/index.js";
export * as shared from "./shared/index.js";
export * as shell from "./shell/NovelApplicationShell.js";
