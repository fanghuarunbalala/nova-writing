/**
 * Platform-neutral handle shared by local and future proxy Conversations.
 * Closing a handle releases handle-local resources; it does not archive or
 * delete the durable Conversation.
 */
import type { ConversationEvents } from "./ConversationEvents.js";
import type { ConversationInput } from "./ConversationInput.js";
import type { ConversationSnapshot } from "./ConversationSnapshot.js";
import type { RuntimePresence } from "./RuntimePresence.js";

export interface Conversation {
  readonly id: string;
  readonly parentConversationId?: string;
  readonly input: ConversationInput;
  readonly events: ConversationEvents;

  getSnapshot(): Promise<ConversationSnapshot>;

  getRuntimePresence(): Promise<RuntimePresence>;

  close(): Promise<void>;
}
