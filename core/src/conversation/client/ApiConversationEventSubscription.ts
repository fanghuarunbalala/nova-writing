/** Validates Transport Event frames and exposes the established Conversation stream. */
import { coreEventSchemaRegistry } from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type {
  ConversationEventSubscription,
  PersistedConversationEventSnapshot,
} from "../../storage/index.js";
import {
  API_PROTOCOL_VERSION,
  type ApiEventFrame,
  type ApiSubscription,
} from "../../transport/index.js";
import { ConversationClientProtocolError } from "./ConversationClientErrors.js";

export interface ApiConversationEventSubscriptionOptions {
  readonly conversationId: string;
  readonly subscription: ApiSubscription;
  readonly logger?: Logger;
}

export class ApiConversationEventSubscription
  implements ConversationEventSubscription
{
  readonly id: string;
  readonly conversationId: string;

  private readonly subscription: ApiSubscription;
  private readonly logger: Logger;
  private closePromise?: Promise<void>;

  constructor(options: ApiConversationEventSubscriptionOptions) {
    this.id = assertNonEmptyString(
      options.subscription.id,
      "API subscription id",
    );
    this.conversationId = assertNonEmptyString(
      options.conversationId,
      "Conversation subscription conversationId",
    );
    this.subscription = options.subscription;
    this.logger = (options.logger ?? noopLogger).child({
      component: "api_conversation_event_subscription",
      conversationId: this.conversationId,
      subscriptionId: this.id,
    });
  }

  async next(): Promise<IteratorResult<PersistedConversationEventSnapshot>> {
    const result = await this.subscription.next();
    if (result.done) return { done: true, value: undefined };

    try {
      const event = validateApiEventFrame(
        result.value,
        this.id,
        this.conversationId,
      );
      this.logger.debug("conversation.client.event_received", {
        sequence: event.sequence,
        direction: event.direction,
        eventType: event.eventType,
      });
      return { done: false, value: event };
    } catch (error) {
      await Promise.allSettled([this.close()]);
      throw error;
    }
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
    this.logger.info("conversation.client.subscription_close_started");
    await this.subscription.close();
    this.logger.info("conversation.client.subscription_close_completed");
  }
}

export function validatePersistedConversationEventSnapshot(
  value: unknown,
  expectedConversationId: string,
): PersistedConversationEventSnapshot {
  const record = assertRecord(value, "Persisted Conversation Event");
  const direction = record.direction;
  if (direction !== "input" && direction !== "output") {
    throw new ConversationClientProtocolError(
      "Persisted Conversation Event direction is invalid",
    );
  }
  const sequence = assertSafeInteger(record.sequence, "Event sequence", 1);
  const recordedAt = assertNonEmptyString(record.recordedAt, "Event recordedAt");
  const { direction: _direction, sequence: _sequence, recordedAt: _recordedAt, ...snapshot } =
    record;
  const validated =
    direction === "input"
      ? coreEventSchemaRegistry.validateInput(snapshot, {
          allowUnknownEventType: true,
        })
      : coreEventSchemaRegistry.validateOutput(snapshot, {
          allowUnknownEventType: true,
        });
  if (validated.conversationId !== expectedConversationId) {
    throw new ConversationClientProtocolError(
      "Persisted Conversation Event targets another Conversation",
    );
  }
  return Object.freeze({
    ...validated,
    direction,
    sequence,
    recordedAt,
  }) as PersistedConversationEventSnapshot;
}

function validateApiEventFrame(
  value: ApiEventFrame,
  expectedSubscriptionId: string,
  expectedConversationId: string,
): PersistedConversationEventSnapshot {
  const frame = assertRecord(value, "API Event frame");
  if (frame.protocolVersion !== API_PROTOCOL_VERSION) {
    throw new ConversationClientProtocolError(
      "API Event frame protocol version is incompatible",
    );
  }
  if (frame.subscriptionId !== expectedSubscriptionId) {
    throw new ConversationClientProtocolError(
      "API Event frame subscriptionId does not match the active subscription",
    );
  }
  return validatePersistedConversationEventSnapshot(
    frame.event,
    expectedConversationId,
  );
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConversationClientProtocolError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConversationClientProtocolError(`${label} must be a non-empty string`);
  }
  return value;
}

function assertSafeInteger(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new ConversationClientProtocolError(
      `${label} must be a safe integer greater than or equal to ${minimum}`,
    );
  }
  return value as number;
}
