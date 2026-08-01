/** Separates durable Journal success from best-effort live publication state. */
import type { JournalAppendReceipt } from "../JournalAppendReceipt.js";
import type { PersistedConversationEventSnapshot } from "../PersistedConversationEventSnapshot.js";

export type ConversationEventLivePublication =
  | {
      status: "published";
    }
  | {
      status: "skipped";
      reason: "duplicate";
    }
  | {
      status: "failed";
      errorName: string;
      errorCode?: string;
    };

export interface ConversationJournalAppendResult {
  receipt: JournalAppendReceipt;
  event: PersistedConversationEventSnapshot;
  livePublication: ConversationEventLivePublication;
}
