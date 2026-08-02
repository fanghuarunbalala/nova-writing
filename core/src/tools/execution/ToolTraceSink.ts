/** Persistence Port for validated redacted Tool Trace records. */
import type { ToolTraceRecord } from "./ToolExecutionContracts.js";

export interface ToolTraceSink {
  append(record: ToolTraceRecord): Promise<void>;
}
