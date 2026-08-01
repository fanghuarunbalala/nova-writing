/** Handle-owned wrapper that unregisters a Subscription after termination. */
import type {
  ConversationEventSubscription,
  PersistedConversationEventSnapshot,
} from "../../storage/index.js";

export interface ManagedConversationEventSubscriptionOptions {
  subscription: ConversationEventSubscription;
  onTerminated: (subscription: ManagedConversationEventSubscription) => void;
}

export class ManagedConversationEventSubscription
  implements ConversationEventSubscription
{
  readonly id: string;
  readonly conversationId: string;

  private readonly subscription: ConversationEventSubscription;
  private readonly onTerminated: (
    subscription: ManagedConversationEventSubscription,
  ) => void;
  private terminated = false;
  private closePromise?: Promise<void>;

  constructor(options: ManagedConversationEventSubscriptionOptions) {
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
