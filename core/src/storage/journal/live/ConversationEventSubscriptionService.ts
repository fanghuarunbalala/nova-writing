/** Journal catch-up followed by live Event delivery without Runtime activation. */
import type {
  ConversationEventSubscription,
  ConversationEventSubscriptionOptions,
} from "./ConversationEventSubscription.js";

export interface ConversationEventSubscriptionService {
  subscribe(options: ConversationEventSubscriptionOptions): ConversationEventSubscription;

  close(): Promise<void>;
}
