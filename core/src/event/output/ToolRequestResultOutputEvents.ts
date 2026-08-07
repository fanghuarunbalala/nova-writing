/**
 * 工具请求/结果输出事件：落盘完整参数与响应，供消息投影与上下文重建。
 * Tool request/result output events persisted for message projection and rebuild.
 */
import type {
  ToolRequestRecord,
  ToolResultRecord,
} from "../../runtime/tools/execution/ToolExecutionContracts.js";
import { OUTPUT_EVENT_TYPE } from "./OutputEventType.js";
import { SystemOutputEvent } from "./SystemOutputEvent.js";
import {
  ToolRequestRecordedPayload,
  ToolResultRecordedPayload,
} from "./payload/ToolRequestResultPayloads.js";

export interface ToolRequestRecordedOutputEventOptions {
  readonly id: string;
  readonly record: ToolRequestRecord;
}

export class ToolRequestRecordedOutputEvent extends SystemOutputEvent {
  constructor(options: ToolRequestRecordedOutputEventOptions) {
    super(
      "tool.request.recorded",
      new ToolRequestRecordedPayload(options.record),
      {
        conversationId: options.record.conversationId,
        id: options.id,
        timestamp: new Date().toISOString(),
        runId: options.record.runId,
        ...(options.record.turnId === undefined
          ? {}
          : { turnId: options.record.turnId }),
      },
    );
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.toolRequestRecorded;
  }
}

export interface ToolResultRecordedOutputEventOptions {
  readonly id: string;
  readonly record: ToolResultRecord;
}

export class ToolResultRecordedOutputEvent extends SystemOutputEvent {
  constructor(options: ToolResultRecordedOutputEventOptions) {
    super(
      "tool.result.recorded",
      new ToolResultRecordedPayload(options.record),
      {
        conversationId: options.record.conversationId,
        id: options.id,
        timestamp: new Date().toISOString(),
        runId: options.record.runId,
        ...(options.record.turnId === undefined
          ? {}
          : { turnId: options.record.turnId }),
      },
    );
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.toolResultRecorded;
  }
}
