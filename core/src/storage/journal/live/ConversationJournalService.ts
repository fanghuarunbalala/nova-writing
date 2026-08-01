/** Host-facing append boundary that persists before attempting live delivery. */
import type { JournalAppendRequest } from "../JournalAppendReceipt.js";
import type { ConversationJournalAppendResult } from "./ConversationJournalAppendResult.js";

export interface ConversationJournalService {
  append(request: JournalAppendRequest): Promise<ConversationJournalAppendResult>;

  close(): Promise<void>;
}
