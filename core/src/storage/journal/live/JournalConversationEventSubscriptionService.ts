/** Creates and owns Journal catch-up subscriptions over a shared live Hub. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { ConversationJournalReader } from "../ConversationJournalStore.js";
import { ConversationEventCatchUpPager } from "./ConversationEventCatchUpPager.js";
import type { ConversationEventHub } from "./ConversationEventHub.js";
import {
  ConversationEventSubscriptionServiceClosedError,
  ConversationEventSubscriptionServiceClosingError,
} from "./ConversationEventLiveErrors.js";
import type { ConversationEventSubscription } from "./ConversationEventSubscription.js";
import {
  normalizeConversationEventSubscriptionOptions,
  type ConversationEventSubscriptionOptions,
} from "./ConversationEventSubscription.js";
import type { ConversationEventSubscriptionService } from "./ConversationEventSubscriptionService.js";
import { JournalConversationEventSubscription } from "./JournalConversationEventSubscription.js";

export interface JournalConversationEventSubscriptionServiceOptions {
  journal: ConversationJournalReader;
  hub: ConversationEventHub;
  logger?: Logger;
  pageSize?: number;
}

type JournalConversationEventSubscriptionServiceState = "open" | "closing" | "closed";

export class JournalConversationEventSubscriptionService
  implements ConversationEventSubscriptionService
{
  private readonly journal: ConversationJournalReader;
  private readonly hub: ConversationEventHub;
  private readonly logger: Logger;
  private readonly pager: ConversationEventCatchUpPager;
  private readonly subscriptions = new Set<JournalConversationEventSubscription>();
  private serviceState: JournalConversationEventSubscriptionServiceState = "open";
  private closePromise?: Promise<void>;

  constructor(options: JournalConversationEventSubscriptionServiceOptions) {
    this.journal = options.journal;
    this.hub = options.hub;
    this.logger = (options.logger ?? noopLogger).child({
      component: "journal_conversation_event_subscription_service",
    });
    this.pager = new ConversationEventCatchUpPager({
      journal: this.journal,
      logger: this.logger,
      ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
    });
  }

  subscribe(options: ConversationEventSubscriptionOptions): ConversationEventSubscription {
    this.assertOpen();
    const normalized = normalizeConversationEventSubscriptionOptions(options);
    let subscription: JournalConversationEventSubscription;
    try {
      subscription = new JournalConversationEventSubscription({
        options: normalized,
        createLiveSubscription: () =>
          this.hub.subscribe({
            conversationId: normalized.conversationId,
            filter: normalized.filter,
            capacity: normalized.liveBufferCapacity,
            ...(normalized.signal !== undefined
              ? { signal: normalized.signal }
              : {}),
          }),
        pager: this.pager,
        getHighWatermark: (conversationId) =>
          this.journal.getHighWatermark(conversationId),
        logger: this.logger,
        onTerminated: (terminated) => {
          this.subscriptions.delete(terminated);
          this.logger.debug("conversation_event.follow.subscription_unregistered", {
            conversationId: terminated.conversationId,
            subscriptionId: terminated.id,
            subscriptionCount: this.subscriptions.size,
          });
        },
      });
    } catch (error) {
      throw error;
    }
    this.subscriptions.add(subscription);
    this.logger.debug("conversation_event.follow.subscription_created", {
      conversationId: subscription.conversationId,
      subscriptionId: subscription.id,
      subscriptionCount: this.subscriptions.size,
    });
    return subscription;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    this.serviceState = "closing";
    const subscriptions = [...this.subscriptions];
    this.logger.info("conversation_event.follow.service.close_started", {
      subscriptionCount: subscriptions.length,
    });
    const errors: unknown[] = [];
    const results = await Promise.allSettled(
      subscriptions.map((subscription) => subscription.close()),
    );
    for (const result of results) {
      if (result.status === "rejected") errors.push(result.reason);
    }
    this.subscriptions.clear();
    this.serviceState = "closed";
    if (errors.length > 0) {
      this.logger.error("conversation_event.follow.service.close_failed", {
        errorCount: errors.length,
      });
      if (errors.length === 1) throw errors[0];
      throw new AggregateError(
        errors,
        "Failed to close Conversation Event follow subscriptions",
      );
    }
    this.logger.info("conversation_event.follow.service.close_completed");
  }

  private assertOpen(): void {
    if (this.serviceState === "closing") {
      throw new ConversationEventSubscriptionServiceClosingError();
    }
    if (this.serviceState === "closed") {
      throw new ConversationEventSubscriptionServiceClosedError();
    }
  }
}
