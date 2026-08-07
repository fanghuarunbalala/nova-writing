/**
 * 工具请求/结果输出事件 payload（完整参数与响应，供上下文与重建）。
 * Tool request/result output payloads with full arguments and responses.
 */
import type { JsonObject, JsonValue } from "../../protocol/JsonValue.js";
import type {
  ToolRequestRecord,
  ToolResultRecord,
} from "../../../runtime/tools/execution/ToolExecutionContracts.js";
import { OutputPayload } from "../OutputPayload.js";

export class ToolRequestRecordedPayload extends OutputPayload {
  readonly record: ToolRequestRecord;

  constructor(record: ToolRequestRecord) {
    super();
    this.record = record;
  }

  toObject(): JsonObject {
    const record = this.record;
    return {
      toolCallId: record.toolCallId,
      toolName: record.toolName,
      toolVersion: record.toolVersion,
      arguments: record.arguments as JsonValue,
      truncated: record.truncated,
    };
  }
}

export class ToolResultRecordedPayload extends OutputPayload {
  readonly record: ToolResultRecord;

  constructor(record: ToolResultRecord) {
    super();
    this.record = record;
  }

  toObject(): JsonObject {
    const record = this.record;
    return {
      toolCallId: record.toolCallId,
      toolName: record.toolName,
      toolVersion: record.toolVersion,
      outcome: record.outcome,
      ...(record.result === undefined ? {} : { result: record.result as JsonValue }),
      ...(record.errorCode === undefined ? {} : { errorCode: record.errorCode }),
      truncated: record.truncated,
    };
  }
}
