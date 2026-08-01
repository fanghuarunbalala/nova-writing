/**
 * Single-consumer in-memory subscription used by the future Event Hub.
 * This implementation stays internal; callers depend on the public interface.
 */
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { PersistedConversationEventSnapshot } from "../PersistedConversationEventSnapshot.js";
import {
  ConversationEventFilterMatcher,
  type NormalizedConversationEventFilter,
} from "./ConversationEventFilter.js";
import {
  ConversationEventSubscriptionAbortedError,
  ConversationEventSubscriptionConcurrentReadError,
  ConversationEventSubscriptionOptionsError,
  ConversationEventSubscriptionOverflowError,
} from "./ConversationEventLiveErrors.js";
import type { ConversationEventSubscription } from "./ConversationEventSubscription.js";
import {
  validateConversationEventSubscriptionCapacity,
  validateConversationEventSubscriptionConversationId,
} from "./ConversationEventSubscription.js";
import {
  BoundedAsyncEventQueue,
  type AsyncEventQueueEnqueueResult,
} from "./BoundedAsyncEventQueue.js";

export type ConversationEventSubscriptionEnqueueResult =
  | "ignored"
  | "enqueued"
  | "overflowed"
  | "closed";

export interface InMemoryConversationEventSubscriptionOptions {
  subscriptionId: string;
  conversationId: string;
  filter: NormalizedConversationEventFilter;
  capacity: number;
  signal?: AbortSignal;
  logger?: Logger;
  onTerminated?: (subscription: InMemoryConversationEventSubscription) => void;
}

type InMemoryConversationEventSubscriptionState = "active" | "closed" | "failed";

export class InMemoryConversationEventSubscription
  implements ConversationEventSubscription
{
  readonly id: string;
  readonly conversationId: string;

  private readonly matcher: ConversationEventFilterMatcher;
  private readonly queue: BoundedAsyncEventQueue<PersistedConversationEventSnapshot>;
  private readonly logger: Logger;
  private readonly signal?: AbortSignal;
  private readonly onTerminated?: (
    subscription: InMemoryConversationEventSubscription,
  ) => void;
  private subscriptionState: InMemoryConversationEventSubscriptionState = "active";
  private deliveredSequence = 0;
  private readPending = false;
  private terminationNotified = false;

  constructor(options: InMemoryConversationEventSubscriptionOptions) {
    if (options.subscriptionId.trim().length === 0) {
      throw new ConversationEventSubscriptionOptionsError(
        "Conversation Event subscriptionId must not be blank",
      );
    }
    this.id = options.subscriptionId;
    this.conversationId = validateConversationEventSubscriptionConversationId(
      options.conversationId,
    );
    this.matcher = new ConversationEventFilterMatcher(options.filter);
    this.queue = new BoundedAsyncEventQueue(
      validateConversationEventSubscriptionCapacity(options.capacity),
    );
    this.signal = options.signal;
    this.onTerminated = options.onTerminated;
    this.logger = (options.logger ?? noopLogger).child({
      component: "in_memory_conversation_event_subscription",
      subscriptionId: this.id,
      conversationId: this.conversationId,
      capacity: this.queue.capacity,
    });

    if (this.signal?.aborted === true) {
      throw this.createAbortedError();
    }
    this.signal?.addEventListener("abort", this.handleAbort, { once: true });
  }

  get state(): InMemoryConversationEventSubscriptionState {
    return this.subscriptionState;
  }

  get bufferedEventCount(): number {
    return this.queue.size;
  }

  get lastDeliveredSequence(): number {
    return this.deliveredSequence;
  }

  enqueue(
    event: PersistedConversationEventSnapshot,
  ): ConversationEventSubscriptionEnqueueResult {
    if (this.subscriptionState !== "active") return "closed";
    if (event.conversationId !== this.conversationId || !this.matcher.matches(event)) {
      this.logger.debug("conversation_event.subscription.event_ignored", {
        eventId: event.id,
        eventType: event.eventType,
        direction: event.direction,
        sequence: event.sequence,
      });
      return "ignored";
    }

    const enqueueResult = this.queue.enqueue(event);
    if (enqueueResult === "full") {
      const overflow = new ConversationEventSubscriptionOverflowError(
        this.id,
        this.conversationId,
        this.queue.capacity,
        this.deliveredSequence,
      );
      this.logger.warn("conversation_event.subscription.overflow", {
        eventId: event.id,
        eventType: event.eventType,
        direction: event.direction,
        sequence: event.sequence,
        bufferedEventCount: this.queue.size,
        lastDeliveredSequence: this.deliveredSequence,
      });
      this.terminateWithFailure(overflow, false);
      return "overflowed";
    }
    if (enqueueResult === "closed") return "closed";
    return this.toSubscriptionEnqueueResult(enqueueResult);
  }

  fail(error: Error): void {
    if (this.subscriptionState !== "active") return;
    this.logger.error("conversation_event.subscription.failed", {
      errorName: error.name,
    });
    this.terminateWithFailure(error, false);
  }

  next(): Promise<IteratorResult<PersistedConversationEventSnapshot>> {
    if (this.readPending) {
      return Promise.reject(
        new ConversationEventSubscriptionConcurrentReadError(
          this.id,
          this.conversationId,
        ),
      );
    }
    this.readPending = true;
    return this.queue
      .next()
      .then((result) => {
        if (!result.done) this.deliveredSequence = result.value.sequence;
        return result;
      })
      .finally(() => {
        this.readPending = false;
      });
  }

  async return(): Promise<IteratorResult<PersistedConversationEventSnapshot>> {
    await this.close();
    return { done: true, value: undefined };
  }

  [Symbol.asyncIterator](): this {
    return this;
  }

  async close(): Promise<void> {
    if (this.subscriptionState !== "active") return;
    this.logger.debug("conversation_event.subscription.close_started");
    this.subscriptionState = "closed";
    this.removeAbortListener();
    this.queue.close();
    this.notifyTerminated();
    this.logger.debug("conversation_event.subscription.closed", {
      lastDeliveredSequence: this.deliveredSequence,
    });
  }

  private readonly handleAbort = (): void => {
    if (this.subscriptionState !== "active") return;
    const error = this.createAbortedError();
    this.logger.warn("conversation_event.subscription.aborted", {
      lastDeliveredSequence: this.deliveredSequence,
    });
    this.terminateWithFailure(error, true);
  };

  private terminateWithFailure(error: Error, abortListenerAlreadyRunning: boolean): void {
    if (this.subscriptionState !== "active") return;
    this.subscriptionState = "failed";
    if (!abortListenerAlreadyRunning) this.removeAbortListener();
    this.queue.fail(error);
    this.notifyTerminated();
  }

  private notifyTerminated(): void {
    if (this.terminationNotified) return;
    this.terminationNotified = true;
    try {
      this.onTerminated?.(this);
    } catch (error) {
      this.logger.error("conversation_event.subscription.termination_callback_failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  private removeAbortListener(): void {
    this.signal?.removeEventListener("abort", this.handleAbort);
  }

  private createAbortedError(): ConversationEventSubscriptionAbortedError {
    return new ConversationEventSubscriptionAbortedError(
      this.id,
      this.conversationId,
      this.deliveredSequence,
      this.signal?.reason === undefined ? undefined : { cause: this.signal.reason },
    );
  }

  private toSubscriptionEnqueueResult(
    result: Exclude<AsyncEventQueueEnqueueResult, "full" | "closed">,
  ): ConversationEventSubscriptionEnqueueResult {
    return result === "delivered" || result === "buffered" ? "enqueued" : "closed";
  }
}
