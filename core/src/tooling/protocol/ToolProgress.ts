/** Asynchronous, private Tool progress channel separate from the final result. */
import type { ToolResultContent } from "./ToolResult.js";

export interface ToolProgressUpdate {
  readonly kind: "progress";
  readonly message?: string;
  readonly completed?: number;
  readonly total?: number;
}

export interface ToolPartialResultUpdate {
  readonly kind: "partial_result";
  readonly content: readonly ToolResultContent[];
}

export type ToolExecutionUpdate = ToolProgressUpdate | ToolPartialResultUpdate;

export interface ToolProgressSink {
  emit(update: ToolExecutionUpdate): Promise<void>;
}

export const noopToolProgressSink: ToolProgressSink = Object.freeze({
  async emit(_update: ToolExecutionUpdate): Promise<void> {},
});
