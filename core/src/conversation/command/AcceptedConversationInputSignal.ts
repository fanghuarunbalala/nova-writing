/**
 * Payload-free Host wake-up signal for one durable InputEvent.
 *
 * The receiver uses the Conversation ID and Journal Sequence to load the
 * canonical snapshot instead of trusting an in-memory payload copy.
 */
import type { JournalAppendStatus } from "../../storage/index.js";
import type { ConversationInputRoute } from "./ConversationInputRoute.js";

export interface AcceptedConversationInputSignal {
  readonly conversationId: string;
  readonly inputEventId: string;
  readonly eventType: string;
  readonly priority: number;
  readonly sequence: number;
  readonly recordedAt: string;
  readonly journalStatus: JournalAppendStatus;
  readonly route: ConversationInputRoute;
  readonly correlationId?: string;
  readonly runId?: string;
  readonly turnId?: string;
}
