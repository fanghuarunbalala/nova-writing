/** Read-only Conversation service; these operations never activate Runtime. */
import type {
  ConversationEventPage,
  ConversationEventSubscription,
} from "../storage/index.js";
import type {
  BoundConversationEventSubscriptionOptions,
  ConversationEventListOptions,
} from "./ConversationEvents.js";
import type { ConversationSnapshotReader } from "./ConversationSnapshotReader.js";

export interface ConversationQueryService extends ConversationSnapshotReader {
  listEvents(
    conversationId: string,
    options: ConversationEventListOptions,
  ): Promise<ConversationEventPage>;

  subscribeEvents(
    conversationId: string,
    options: BoundConversationEventSubscriptionOptions,
  ): ConversationEventSubscription;
}
