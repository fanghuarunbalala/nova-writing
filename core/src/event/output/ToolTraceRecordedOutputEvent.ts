/** Persisted public OutputEvent for one redacted Tool Trace stage. */
import type { ToolTraceRecord } from "../../runtime/tools/execution/ToolExecutionContracts.js";
import { captureToolTraceRecord } from "../../runtime/tools/execution/ToolExecutionProtocolValidator.js";
import { OUTPUT_EVENT_TYPE } from "./OutputEventType.js";
import { SystemOutputEvent } from "./SystemOutputEvent.js";
import { ToolTraceRecordedPayload } from "./payload/ToolTraceRecordedPayload.js";

export interface ToolTraceRecordedOutputEventOptions {
  readonly id: string;
  readonly record: ToolTraceRecord;
}

export class ToolTraceRecordedOutputEvent extends SystemOutputEvent {
  constructor(options: ToolTraceRecordedOutputEventOptions) {
    const record = captureToolTraceRecord(options.record);
    super("tool.trace.recorded", new ToolTraceRecordedPayload(record), {
      conversationId: record.conversationId,
      id: options.id,
      timestamp: record.timestamp,
      runId: record.runId,
      ...(record.turnId === undefined
        ? {}
        : { turnId: record.turnId }),
    });
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.toolTraceRecorded;
  }
}
