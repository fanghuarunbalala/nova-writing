/** Narrow read-only boundary for durable Conversation snapshots. */
import type { ConversationSnapshot } from "./ConversationSnapshot.js";

export interface ConversationSnapshotReader {
  getSnapshot(conversationId: string): Promise<ConversationSnapshot>;
}
