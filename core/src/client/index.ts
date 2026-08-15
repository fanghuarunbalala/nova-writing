// client 域统一出口：精简客户端门面 + 投影（UI 消费侧，browser-safe）
// 额外导出 browser-safe 的 noopLogger（不拉 pino）

export * from "./NovelApiClient.js";
export * from "./ConversationProjection.js";
export * from "../conversation/CardProjection.js";
// 投影快照/时间线项引用的会话模式类型（type-only，browser-safe；消费侧头部 chip 使用）
export type { ConversationMode } from "../conversation/contract/types/index.js";
export { noopLogger } from "../log/noop.js";
export { debugLog, infoLog, isVerboseLog } from "../log/debug.js";
// RPC 错误类型（纯类，browser-safe）：renderer 侧错误处理需要——值导入必须
// 走本出口而非根入口（根入口 re-export event/EventPublisher → zeromq 原生
// addon 模块顶层加载，浏览器环境抛 __dirname is not defined → renderer 白屏）
export { RPCError, ApiTransportError } from "../rpc/RPCError.js";
