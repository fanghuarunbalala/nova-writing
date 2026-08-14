// client 域统一出口：精简客户端门面 + 投影（UI 消费侧，browser-safe）
// 额外导出 browser-safe 的 noopLogger（不拉 pino）

export * from "./NovelApiClient.js";
export * from "./ConversationProjection.js";
export * from "../conversation/CardProjection.js";
export { noopLogger } from "../log/noop.js";
export { debugLog, infoLog, isVerboseLog } from "../log/debug.js";
