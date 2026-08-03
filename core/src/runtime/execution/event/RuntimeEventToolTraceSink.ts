/** Persists redacted Tool Trace records through the Runtime OutputEvent barrier. */
import { ToolTraceRecordedOutputEvent } from "../../../event/output/ToolTraceRecordedOutputEvent.js";
import type { ToolTraceRecord } from "../../tools/execution/ToolExecutionContracts.js";
import { captureToolTraceRecord } from "../../tools/execution/ToolExecutionProtocolValidator.js";
import type { ToolTraceSink } from "../../tools/execution/ToolTraceSink.js";
import type { RuntimeEventSink } from "./RuntimeEventSink.js";

export interface ToolTraceEventIdFactory {
  create(record: ToolTraceRecord): string;
}

export interface RuntimeEventToolTraceSinkOptions {
  readonly eventSink: RuntimeEventSink;
  readonly eventIdFactory?: ToolTraceEventIdFactory;
}

export class RuntimeEventToolTraceSink implements ToolTraceSink {
  readonly #eventSink: RuntimeEventSink;
  readonly #eventIdFactory: ToolTraceEventIdFactory;

  constructor(options: RuntimeEventToolTraceSinkOptions) {
    this.#eventSink = options.eventSink;
    this.#eventIdFactory = options.eventIdFactory ?? DEFAULT_TRACE_EVENT_ID_FACTORY;
  }

  async append(recordSource: ToolTraceRecord): Promise<void> {
    const record = captureToolTraceRecord(recordSource);
    await this.#eventSink.append(new ToolTraceRecordedOutputEvent({
      id: this.#eventIdFactory.create(record),
      record,
    }));
  }
}

const DEFAULT_TRACE_EVENT_ID_FACTORY: ToolTraceEventIdFactory = Object.freeze({
  create(record: ToolTraceRecord): string {
    return `evt_tool_trace_${record.traceId}_${record.attempt}_${record.stage}`;
  },
});
