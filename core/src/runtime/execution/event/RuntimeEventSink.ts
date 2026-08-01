/** Persistence barrier used by ConversationRuntime before advancing execution state. */
import type { OutputEvent } from "../../../event/output/OutputEvent.js";

export const RUNTIME_EVENT_APPEND_STATUS = {
  recorded: "recorded",
  duplicate: "duplicate",
} as const;

export type RuntimeEventAppendStatus =
  (typeof RUNTIME_EVENT_APPEND_STATUS)[keyof typeof RUNTIME_EVENT_APPEND_STATUS];

export interface RuntimeEventAppendReceipt {
  readonly status: RuntimeEventAppendStatus;
  readonly conversationId: string;
  readonly eventId: string;
  readonly sequence: number;
  readonly recordedAt: string;
}

export interface RuntimeEventSink {
  append(event: OutputEvent): Promise<RuntimeEventAppendReceipt>;
}
