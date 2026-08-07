/**
 * 把工具请求/结果记录写入 Runtime 输出事件（journal）。
 * Persists tool request/result records as runtime output events.
 */
import {
  ToolRequestRecordedOutputEvent,
  ToolResultRecordedOutputEvent,
} from "../../../event/output/index.js";
import type {
  ToolRequestRecord,
  ToolResultRecord,
} from "../../tools/execution/ToolExecutionContracts.js";
import type { ToolLifecycleSink } from "../../tools/execution/ToolLifecycleSink.js";
import type { RuntimeEventSink } from "./RuntimeEventSink.js";

export interface RuntimeEventToolLifecycleSinkOptions {
  readonly eventSink: RuntimeEventSink;
}

export class RuntimeEventToolLifecycleSink implements ToolLifecycleSink {
  readonly #eventSink: RuntimeEventSink;

  constructor(options: RuntimeEventToolLifecycleSinkOptions) {
    this.#eventSink = options.eventSink;
  }

  async appendRequest(record: ToolRequestRecord): Promise<void> {
    await this.#eventSink.append(
      new ToolRequestRecordedOutputEvent({
        id: `evt_tool_request_${record.toolCallId}`,
        record,
      }),
    );
  }

  async appendResult(record: ToolResultRecord): Promise<void> {
    await this.#eventSink.append(
      new ToolResultRecordedOutputEvent({
        id: `evt_tool_result_${record.toolCallId}`,
        record,
      }),
    );
  }
}
