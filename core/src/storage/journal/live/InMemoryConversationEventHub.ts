/**
 * Process-local broadcast Hub for Events that already committed to Journal,
 * plus streaming deltas that are broadcast without durable sequence.
 * Historical replay remains a separate Journal subscription service concern.
 *
 * @example
 * ```ts
 * const hub = new InMemoryConversationEventHub();
 * const subscription = hub.subscribe({ conversationId });
 * await hub.publish(persistedEvent);
 * ```
 */
import { OUTPUT_EVENT_TYPE, isEventType } from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { PersistedConversationEventSnapshot } from "../PersistedConversationEventSnapshot.js";
import type { ConversationEventHub } from "./ConversationEventHub.js";
import {
  ConversationEventHubClosedError,
  ConversationEventHubPublishError,
  ConversationEventHubSequenceError,
} from "./ConversationEventLiveErrors.js";
import type { ConversationEventSubscription } from "./ConversationEventSubscription.js";
import {
  normalizeLiveConversationEventSubscriptionOptions,
  type LiveConversationEventSubscriptionOptions,
} from "./ConversationEventSubscription.js";
import { InMemoryConversationEventSubscription } from "./InMemoryConversationEventSubscription.js";

export interface InMemoryConversationEventHubOptions {
  logger?: Logger;
}

interface ConversationEventChannel {
  lastPublishedSequence?: number;
  subscriptions: Map<string, InMemoryConversationEventSubscription>;
}

type InMemoryConversationEventHubState = "open" | "closing" | "closed";

export class InMemoryConversationEventHub implements ConversationEventHub {
  private readonly logger: Logger;
  private readonly channels = new Map<string, ConversationEventChannel>();
  private hubState: InMemoryConversationEventHubState = "open";
  private subscriptionSequence = 0;
  private closePromise?: Promise<void>;

  constructor(options: InMemoryConversationEventHubOptions = {}) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "in_memory_conversation_event_hub",
    });
  }

  async publish(event: PersistedConversationEventSnapshot): Promise<void> {
    this.assertOpen();
    this.validatePersistedEvent(event);
    const channel = this.getOrCreateChannel(event.conversationId);
    // 流式 delta 不落盘：不参与 journal sequence 校验、不占位。
    if (event.eventType !== OUTPUT_EVENT_TYPE.agentAssistantMessageDelta) {
      this.assertNextSequence(event, channel);
      channel.lastPublishedSequence = event.sequence;
    }

    const subscriptions = [...channel.subscriptions.values()];
    let enqueuedCount = 0;
    let ignoredCount = 0;
    let overflowCount = 0;
    for (const subscription of subscriptions) {
      const result = subscription.enqueue(event);
      if (result === "enqueued") enqueuedCount += 1;
      else if (result === "ignored") ignoredCount += 1;
      else if (result === "overflowed") {
        overflowCount += 1;
        this.logger.warn("conversation_event.publish.subscription_overflowed", {
          conversationId: event.conversationId,
          subscriptionId: subscription.id,
          eventId: event.id,
          eventType: event.eventType,
          direction: event.direction,
          sequence: event.sequence,
        });
      } else {
        this.removeSubscription(event.conversationId, subscription);
      }
    }

    this.logger.debug("conversation_event.publish.completed", {
      conversationId: event.conversationId,
      eventId: event.id,
      eventType: event.eventType,
      direction: event.direction,
      sequence: event.sequence,
      subscriberCount: subscriptions.length,
      enqueuedCount,
      ignoredCount,
      overflowCount,
    });
  }

  subscribe(
    options: LiveConversationEventSubscriptionOptions,
  ): ConversationEventSubscription {
    this.assertOpen();
    const normalized = normalizeLiveConversationEventSubscriptionOptions(options);
    const channel = this.getOrCreateChannel(normalized.conversationId);
    const subscriptionId = this.createSubscriptionId();
    let subscription: InMemoryConversationEventSubscription;
    try {
      subscription = new InMemoryConversationEventSubscription({
        subscriptionId,
        conversationId: normalized.conversationId,
        filter: normalized.filter,
        capacity: normalized.capacity,
        logger: this.logger,
        ...(normalized.signal !== undefined ? { signal: normalized.signal } : {}),
        onTerminated: (terminated) => {
          this.removeSubscription(normalized.conversationId, terminated);
        },
      });
    } catch (error) {
      if (
        channel.subscriptions.size === 0 &&
        channel.lastPublishedSequence === undefined
      ) {
        this.channels.delete(normalized.conversationId);
      }
      throw error;
    }
    channel.subscriptions.set(subscription.id, subscription);
    this.logger.debug("conversation_event.subscription.created", {
      conversationId: normalized.conversationId,
      subscriptionId: subscription.id,
      capacity: normalized.capacity,
      subscriptionCount: channel.subscriptions.size,
    });
    return subscription;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    this.hubState = "closing";
    const subscriptions = [...this.channels.values()].flatMap((channel) => [
      ...channel.subscriptions.values(),
    ]);
    this.logger.info("conversation_event.hub.close_started", {
      conversationCount: this.channels.size,
      subscriptionCount: subscriptions.length,
    });
    const errors: unknown[] = [];
    const results = await Promise.allSettled(
      subscriptions.map((subscription) => subscription.close()),
    );
    for (const result of results) {
      if (result.status === "rejected") errors.push(result.reason);
    }
    this.channels.clear();
    this.hubState = "closed";

    if (errors.length > 0) {
      this.logger.error("conversation_event.hub.close_failed", {
        errorCount: errors.length,
      });
      if (errors.length === 1) throw errors[0];
      throw new AggregateError(errors, "Failed to close Conversation Event Hub subscriptions");
    }
    this.logger.info("conversation_event.hub.close_completed");
  }

  private getOrCreateChannel(conversationId: string): ConversationEventChannel {
    const existing = this.channels.get(conversationId);
    if (existing !== undefined) return existing;
    const created: ConversationEventChannel = {
      subscriptions: new Map(),
    };
    this.channels.set(conversationId, created);
    return created;
  }

  private assertNextSequence(
    event: PersistedConversationEventSnapshot,
    channel: ConversationEventChannel,
  ): void {
    const previousSequence = channel.lastPublishedSequence;
    if (previousSequence === undefined) return;
    const expectedSequence = previousSequence + 1;
    if (event.sequence === expectedSequence) return;

    const error = new ConversationEventHubSequenceError(
      event.conversationId,
      expectedSequence,
      event.sequence,
    );
    if (event.sequence > previousSequence) {
      channel.lastPublishedSequence = event.sequence;
    }
    this.logger.error("conversation_event.publish.sequence_error", {
      conversationId: event.conversationId,
      eventId: event.id,
      eventType: event.eventType,
      direction: event.direction,
      expectedSequence,
      actualSequence: event.sequence,
      subscriptionCount: channel.subscriptions.size,
    });
    this.failChannelSubscriptions(channel, error);
    throw error;
  }

  private failChannelSubscriptions(
    channel: ConversationEventChannel,
    error: Error,
  ): void {
    for (const subscription of [...channel.subscriptions.values()]) {
      subscription.fail(error);
    }
    channel.subscriptions.clear();
  }

  private removeSubscription(
    conversationId: string,
    subscription: InMemoryConversationEventSubscription,
  ): void {
    const channel = this.channels.get(conversationId);
    if (channel === undefined) return;
    if (channel.subscriptions.get(subscription.id) !== subscription) return;
    channel.subscriptions.delete(subscription.id);
    this.logger.debug("conversation_event.subscription.unregistered", {
      conversationId,
      subscriptionId: subscription.id,
      subscriptionCount: channel.subscriptions.size,
    });
    if (
      channel.subscriptions.size === 0 &&
      channel.lastPublishedSequence === undefined
    ) {
      this.channels.delete(conversationId);
    }
  }

  private createSubscriptionId(): string {
    this.subscriptionSequence += 1;
    if (!Number.isSafeInteger(this.subscriptionSequence)) {
      throw new ConversationEventHubPublishError(
        "Conversation Event Subscription ID sequence is exhausted",
      );
    }
    return `conversation-event-subscription-${this.subscriptionSequence}`;
  }

  private validatePersistedEvent(event: PersistedConversationEventSnapshot): void {
    if (event === null || typeof event !== "object" || Array.isArray(event)) {
      throw new ConversationEventHubPublishError("Persisted Conversation Event must be an object");
    }
    this.assertNonBlank("conversationId", event.conversationId);
    this.assertNonBlank("eventId", event.id);
    if (!isEventType(event.eventType)) {
      throw new ConversationEventHubPublishError(
        `Persisted Conversation Event has invalid Event Type: ${event.eventType}`,
      );
    }
    if (event.direction !== "input" && event.direction !== "output") {
      throw new ConversationEventHubPublishError(
        "Persisted Conversation Event direction must be input or output",
      );
    }
    if (!Number.isSafeInteger(event.schemaVersion) || event.schemaVersion < 1) {
      throw new ConversationEventHubPublishError(
        "Persisted Conversation Event schemaVersion must be a positive safe integer",
      );
    }
    if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
      throw new ConversationEventHubPublishError(
        "Persisted Conversation Event Sequence must be a positive safe integer",
      );
    }
    this.assertTimestamp("timestamp", event.timestamp);
    this.assertTimestamp("recordedAt", event.recordedAt);
  }

  private assertNonBlank(label: string, value: string): void {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ConversationEventHubPublishError(
        `Persisted Conversation Event ${label} must not be blank`,
      );
    }
  }

  private assertTimestamp(label: string, value: string): void {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
      throw new ConversationEventHubPublishError(
        `Persisted Conversation Event ${label} must be a valid timestamp`,
      );
    }
  }

  private assertOpen(): void {
    if (this.hubState !== "open") throw new ConversationEventHubClosedError();
  }
}
