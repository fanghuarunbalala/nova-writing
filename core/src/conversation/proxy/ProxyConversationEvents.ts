/** Conversation-bound Event adapter that owns only subscriptions created by its Proxy. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type {
  ConversationEventPage,
  ConversationEventSubscription,
  PersistedConversationEventSnapshot,
} from "../../storage/index.js";
import type { ConversationClient } from "../client/index.js";
import type {
  BoundConversationEventSubscriptionOptions,
  ConversationEventListOptions,
  ConversationEvents,
} from "../ConversationEvents.js";

export interface ProxyConversationEventsOptions {
  readonly conversationId: string;
  readonly client: ConversationClient;
  readonly assertHandleOpen: () => void;
  readonly logger?: Logger;
}

export class ProxyConversationEvents implements ConversationEvents {
  private readonly conversationId: string;
  private readonly client: ConversationClient;
  private readonly assertHandleOpen: () => void;
  private readonly logger: Logger;
  private readonly subscriptions = new Set<ManagedProxyConversationSubscription>();

  constructor(options: ProxyConversationEventsOptions) {
    this.conversationId = options.conversationId;
    this.client = options.client;
    this.assertHandleOpen = options.assertHandleOpen;
    this.logger = (options.logger ?? noopLogger).child({
      component: "proxy_conversation_events",
      conversationId: this.conversationId,
    });
  }

  list(options: ConversationEventListOptions): Promise<ConversationEventPage> {
    this.assertHandleOpen();
    return this.client.listEvents(this.conversationId, options);
  }

  subscribe(
    options: BoundConversationEventSubscriptionOptions,
  ): ConversationEventSubscription {
    this.assertHandleOpen();
    const underlying = this.client.subscribeEvents(this.conversationId, options);
    const managed = new ManagedProxyConversationSubscription({
      subscription: underlying,
      onTerminated: (subscription) => {
        if (!this.subscriptions.delete(subscription)) return;
        this.logger.debug("conversation.proxy.subscription_unregistered", {
          subscriptionId: subscription.id,
          subscriptionCount: this.subscriptions.size,
        });
      },
    });
    this.subscriptions.add(managed);
    this.logger.debug("conversation.proxy.subscription_registered", {
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

    this.logger.error("conversation.proxy.subscriptions_close_failed", {
      subscriptionCount: subscriptions.length,
      errorCount: errors.length,
    });
    if (errors.length === 1) throw errors[0];
    throw new AggregateError(
      errors,
      "Failed to close Conversation Proxy subscriptions",
    );
  }
}

interface ManagedProxyConversationSubscriptionOptions {
  readonly subscription: ConversationEventSubscription;
  readonly onTerminated: (
    subscription: ManagedProxyConversationSubscription,
  ) => void;
}

class ManagedProxyConversationSubscription
  implements ConversationEventSubscription
{
  readonly id: string;
  readonly conversationId: string;

  private readonly subscription: ConversationEventSubscription;
  private readonly onTerminated: (
    subscription: ManagedProxyConversationSubscription,
  ) => void;
  private terminated = false;
  private closePromise?: Promise<void>;

  constructor(options: ManagedProxyConversationSubscriptionOptions) {
    this.subscription = options.subscription;
    this.onTerminated = options.onTerminated;
    this.id = options.subscription.id;
    this.conversationId = options.subscription.conversationId;
  }

  next(): Promise<IteratorResult<PersistedConversationEventSnapshot>> {
    return this.subscription.next().then(
      (result) => {
        if (result.done) this.notifyTerminated();
        return result;
      },
      (error: unknown) => {
        this.notifyTerminated();
        throw error;
      },
    );
  }

  async return(): Promise<IteratorResult<PersistedConversationEventSnapshot>> {
    await this.close();
    return { done: true, value: undefined };
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    try {
      await this.subscription.close();
    } finally {
      this.notifyTerminated();
    }
  }

  private notifyTerminated(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.onTerminated(this);
  }
}
