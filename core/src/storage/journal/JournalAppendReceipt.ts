import type { EventKind, InputEventSnapshot, OutputEventSnapshot } from "../../event/index.js";

export type JournalAppendRequest =
  | {
      direction: "input";
      snapshot: InputEventSnapshot;
    }
  | {
      direction: "output";
      snapshot: OutputEventSnapshot;
    };

export type JournalAppendStatus = "appended" | "duplicate";

export interface JournalAppendReceipt {
  status: JournalAppendStatus;
  conversationId: string;
  eventId: string;
  direction: EventKind;
  sequence: number;
  recordedAt: string;
}
