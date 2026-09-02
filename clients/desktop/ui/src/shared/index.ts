/**
 * shared 层公共出口。
 *
 * 注意：@novel/ui 公共入口（src/index.ts）在 Phase 3 shell 组合层落地时
 * 再接入本 barrel，避免与本阶段未提交的现有入口改动混叠。
 */
export * from "./primitives/index.js";
export * from "./routing/index.js";
export * from "./state/index.js";
export * from "./theme/index.js";
