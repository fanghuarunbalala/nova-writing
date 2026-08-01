/**
 * Event history and follow API bound to one Conversation.
 *
 * Callers cannot override `conversationId`; local handles and future proxies
 * inject the bound identifier before delegating to a query service.
 */
import type {
  ConversationEventPage,
  ConversationEventQuery,
} from "../storage/index.js";
import type {
  ConversationEventSubscription,
  ConversationEventSubscriptionOptions,
} from "../storage/index.js";

export type ConversationEventListOptions = Omit<
  ConversationEventQuery,
  "conversationId"
>;

export type BoundConversationEventSubscriptionOptions = Omit<
  ConversationEventSubscriptionOptions,
  "conversationId"
>;

export interface ConversationEvents {
  list(options: ConversationEventListOptions): Promise<ConversationEventPage>;

  subscribe(
    options: BoundConversationEventSubscriptionOptions,
  ): ConversationEventSubscription;
}
