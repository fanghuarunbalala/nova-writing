/** Adapts the shared Conversation Output publisher into a Runtime persistence barrier. */
import {
  ConversationOutputConflictError,
  ConversationOutputPersistenceError,
  ConversationOutputRejectedError,
} from "../../../conversation/output/ConversationOutputErrors.js";
import type { ConversationOutputEventPublisher } from "../../../conversation/output/ConversationOutputEventPublisher.js";
import type { OutputReceipt } from "../../../conversation/output/OutputReceipt.js";
import type { OutputEvent } from "../../../event/output/OutputEvent.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  RUNTIME_EVENT_APPEND_FAILURE,
  RuntimeEventAppendError,
  type RuntimeEventAppendFailure,
} from "./RuntimeEventAppendError.js";
import {
  RUNTIME_EVENT_APPEND_STATUS,
  type RuntimeEventAppendReceipt,
  type RuntimeEventSink,
} from "./RuntimeEventSink.js";

export interface PublishingRuntimeEventSinkOptions {
  outputPublisher: ConversationOutputEventPublisher;
  logger?: Logger;
}

interface RuntimeEventLogIdentity {
  conversationId: string;
  eventId: string;
  eventType: string;
}

export class PublishingRuntimeEventSink implements RuntimeEventSink {
  private readonly outputPublisher: ConversationOutputEventPublisher;
  private readonly logger: Logger;

  constructor(options: PublishingRuntimeEventSinkOptions) {
    this.outputPublisher = options.outputPublisher;
    this.logger = (options.logger ?? noopLogger).child({
      component: "publishing_runtime_event_sink",
    });
  }

  async append(event: OutputEvent): Promise<RuntimeEventAppendReceipt> {
    const identity = captureEventIdentity(event);
    this.logger.debug("runtime.event.append_started", { ...identity });

    let outputReceipt: OutputReceipt;
    try {
      outputReceipt = await this.outputPublisher.publish(event);
    } catch (error) {
      const failure = classifyFailure(error);
      this.logger.error("runtime.event.append_failed", {
        ...identity,
        failure,
      });
      throw new RuntimeEventAppendError(
        identity.conversationId,
        identity.eventId,
        identity.eventType,
        failure,
      );
    }

    let receipt: RuntimeEventAppendReceipt;
    try {
      receipt = captureReceipt(outputReceipt, identity);
    } catch {
      this.logger.error("runtime.event.append_failed", {
        ...identity,
        failure: RUNTIME_EVENT_APPEND_FAILURE.invalidReceipt,
      });
      throw new RuntimeEventAppendError(
        identity.conversationId,
        identity.eventId,
        identity.eventType,
        RUNTIME_EVENT_APPEND_FAILURE.invalidReceipt,
      );
    }

    this.logger.info("runtime.event.append_completed", {
      ...identity,
      status: receipt.status,
      sequence: receipt.sequence,
    });
    return receipt;
  }
}

function captureEventIdentity(event: OutputEvent): RuntimeEventLogIdentity {
  if (event === null || typeof event !== "object") {
    throw new TypeError("Runtime Event must be an OutputEvent object");
  }
  const eventType = event.getEventType();
  assertNonBlank("Conversation ID", event.conversationId);
  assertNonBlank("Runtime Event ID", event.id);
  assertNonBlank("Runtime Event type", eventType);
  return Object.freeze({
    conversationId: event.conversationId,
    eventId: event.id,
    eventType,
  });
}

function captureReceipt(
  receipt: OutputReceipt,
  identity: RuntimeEventLogIdentity,
): RuntimeEventAppendReceipt {
  if (receipt === null || typeof receipt !== "object") {
    throw new TypeError("Runtime Event append receipt must be an object");
  }
  if (receipt.status !== "recorded" && receipt.status !== "duplicate") {
    throw new TypeError("Runtime Event append receipt status is invalid");
  }
  if (
    receipt.conversationId !== identity.conversationId ||
    receipt.outputEventId !== identity.eventId
  ) {
    throw new TypeError("Runtime Event append receipt identity is invalid");
  }
  if (!Number.isSafeInteger(receipt.sequence) || receipt.sequence <= 0) {
    throw new TypeError("Runtime Event append receipt Sequence is invalid");
  }
  if (
    typeof receipt.recordedAt !== "string" ||
    Number.isNaN(Date.parse(receipt.recordedAt))
  ) {
    throw new TypeError("Runtime Event append receipt timestamp is invalid");
  }

  return Object.freeze({
    status:
      receipt.status === "recorded"
        ? RUNTIME_EVENT_APPEND_STATUS.recorded
        : RUNTIME_EVENT_APPEND_STATUS.duplicate,
    conversationId: receipt.conversationId,
    eventId: receipt.outputEventId,
    sequence: receipt.sequence,
    recordedAt: receipt.recordedAt,
  });
}

function classifyFailure(error: unknown): RuntimeEventAppendFailure {
  if (error instanceof ConversationOutputRejectedError) {
    return RUNTIME_EVENT_APPEND_FAILURE.rejected;
  }
  if (error instanceof ConversationOutputConflictError) {
    return RUNTIME_EVENT_APPEND_FAILURE.conflict;
  }
  if (error instanceof ConversationOutputPersistenceError) {
    return RUNTIME_EVENT_APPEND_FAILURE.persistenceFailed;
  }
  return RUNTIME_EVENT_APPEND_FAILURE.publisherFailed;
}

function assertNonBlank(label: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
}
