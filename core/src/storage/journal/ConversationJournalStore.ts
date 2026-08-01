import type { ConversationEventPage, ConversationEventQuery } from "./ConversationEventQuery.js";
import type { JournalAppendReceipt, JournalAppendRequest } from "./JournalAppendReceipt.js";
import type { PersistedConversationEventSnapshot } from "./PersistedConversationEventSnapshot.js";

export interface ConversationJournalWriter {
  /**
   * Appends one durable Event. Input appends must atomically reject new Events
   * for Conversations that are not active while preserving duplicate lookup.
   */
  append(request: JournalAppendRequest): Promise<JournalAppendReceipt>;
}

export interface ConversationJournalReader {
  getHighWatermark(conversationId: string): Promise<number>;

  getBySequence(
    conversationId: string,
    sequence: number,
  ): Promise<PersistedConversationEventSnapshot | undefined>;

  getByEventId(
    conversationId: string,
    eventId: string,
  ): Promise<PersistedConversationEventSnapshot | undefined>;

  list(query: ConversationEventQuery): Promise<ConversationEventPage>;
}

export interface ConversationJournalStore
  extends ConversationJournalWriter,
    ConversationJournalReader {}
