/** Live-only Event broadcast boundary; historical reads remain Journal-owned. */
import type { PersistedConversationEventSnapshot } from "../PersistedConversationEventSnapshot.js";
import type {
  ConversationEventSubscription,
  LiveConversationEventSubscriptionOptions,
} from "./ConversationEventSubscription.js";

export interface ConversationEventHub {
  publish(event: PersistedConversationEventSnapshot): Promise<void>;

  subscribe(
    options: LiveConversationEventSubscriptionOptions,
  ): ConversationEventSubscription;

  close(): Promise<void>;
}
