/** Conversation-bound query adapter that owns subscriptions created by a Handle. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type {
  ConversationEventPage,
  ConversationEventSubscription,
} from "../../storage/index.js";
import type {
  BoundConversationEventSubscriptionOptions,
  ConversationEventListOptions,
  ConversationEvents,
} from "../ConversationEvents.js";
import type { ConversationQueryService } from "../ConversationQueryService.js";
import { ManagedConversationEventSubscription } from "./ManagedConversationEventSubscription.js";

export interface LocalConversationEventsOptions {
  conversationId: string;
  queryService: ConversationQueryService;
  assertHandleOpen: () => void;
  logger?: Logger;
}

export class LocalConversationEvents implements ConversationEvents {
  private readonly conversationId: string;
  private readonly queryService: ConversationQueryService;
  private readonly assertHandleOpen: () => void;
  private readonly logger: Logger;
  private readonly subscriptions = new Set<ManagedConversationEventSubscription>();

  constructor(options: LocalConversationEventsOptions) {
    this.conversationId = options.conversationId;
    this.queryService = options.queryService;
    this.assertHandleOpen = options.assertHandleOpen;
    this.logger = (options.logger ?? noopLogger).child({
      component: "local_conversation_events",
      conversationId: options.conversationId,
    });
  }

  list(options: ConversationEventListOptions): Promise<ConversationEventPage> {
    this.assertHandleOpen();
    return this.queryService.listEvents(this.conversationId, options);
  }

  subscribe(
    options: BoundConversationEventSubscriptionOptions,
  ): ConversationEventSubscription {
    this.assertHandleOpen();
    const underlying = this.queryService.subscribeEvents(this.conversationId, options);
    const managed = new ManagedConversationEventSubscription({
      subscription: underlying,
      onTerminated: (subscription) => {
        if (!this.subscriptions.delete(subscription)) return;
        this.logger.debug("conversation.handle.subscription_unregistered", {
          subscriptionId: subscription.id,
          subscriptionCount: this.subscriptions.size,
        });
      },
    });
    this.subscriptions.add(managed);
    this.logger.debug("conversation.handle.subscription_registered", {
      subscriptionId: managed.id,
      subscriptionCount: this.subscriptions.size,
    });
    return managed;
  }

  async closeSubscriptions(): Promise<void> {
    const subscriptions = [...this.subscriptions];
    const results = await Promise.allSettled(
      subscriptions.map((subscription) => subscription.close()),
    );
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    this.subscriptions.clear();
    if (errors.length === 0) return;

    this.logger.error("conversation.handle.subscriptions_close_failed", {
      subscriptionCount: subscriptions.length,
      errorCount: errors.length,
    });
    if (errors.length === 1) throw errors[0];
    throw new AggregateError(errors, "Failed to close Conversation Handle subscriptions");
  }
}
