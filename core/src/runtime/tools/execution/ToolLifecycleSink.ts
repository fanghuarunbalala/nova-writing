/**
 * 工具请求/结果持久化端口：完整参数与响应落盘，供消息投影与上下文重建。
 * Tool request/result persistence port for message projection and rebuild.
 */
import type {
  ToolRequestRecord,
  ToolResultRecord,
} from "./ToolExecutionContracts.js";

export interface ToolLifecycleSink {
  appendRequest(record: ToolRequestRecord): Promise<void>;
  appendResult(record: ToolResultRecord): Promise<void>;
}
