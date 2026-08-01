/** Read-only Conversation service; these operations never activate Runtime. */
import type {
  ConversationEventPage,
  ConversationEventSubscription,
} from "../storage/index.js";
import type {
  BoundConversationEventSubscriptionOptions,
  ConversationEventListOptions,
} from "./ConversationEvents.js";
import type { ConversationSnapshot } from "./ConversationSnapshot.js";

export interface ConversationQueryService {
  getSnapshot(conversationId: string): Promise<ConversationSnapshot>;

  listEvents(
    conversationId: string,
    options: ConversationEventListOptions,
  ): Promise<ConversationEventPage>;

  subscribeEvents(
    conversationId: string,
    options: BoundConversationEventSubscriptionOptions,
  ): ConversationEventSubscription;
}
