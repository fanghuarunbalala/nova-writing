/**
 * Validates OutputEvent schemas and records them through the unified Journal.
 *
 * Live EventHub failure is deliberately degraded after durable persistence;
 * callers receive a successful OutputReceipt whenever the Journal committed.
 */
import {
  canonicalStringifyJson,
  EventValidationError,
  type EventSchemaRegistry,
  type JsonValue,
  type OutputEvent,
  type OutputEventSnapshot,
} from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  JournalEventConflictError,
  type ConversationJournalAppendResult,
  type ConversationJournalService,
} from "../../storage/index.js";
import type { ConversationOutputEventPublisher } from "./ConversationOutputEventPublisher.js";
import {
  ConversationOutputConflictError,
  ConversationOutputPersistenceError,
  ConversationOutputRejectedError,
  type ConversationOutputRejectionReason,
} from "./ConversationOutputErrors.js";
import {
  OUTPUT_RECEIPT_STATUS,
  type OutputReceipt,
} from "./OutputReceipt.js";

export interface StorageConversationOutputEventPublisherOptions {
  eventSchemaRegistry: EventSchemaRegistry;
  journalService: ConversationJournalService;
  logger?: Logger;
}

interface OutputLogIdentity {
  conversationId: string;
  outputEventId: string;
  eventType: string;
}

export class StorageConversationOutputEventPublisher
  implements ConversationOutputEventPublisher
{
  private readonly eventSchemaRegistry: EventSchemaRegistry;
  private readonly journalService: ConversationJournalService;
  private readonly logger: Logger;

  constructor(options: StorageConversationOutputEventPublisherOptions) {
    this.eventSchemaRegistry = options.eventSchemaRegistry;
    this.journalService = options.journalService;
    this.logger = (options.logger ?? noopLogger).child({
      component: "storage_conversation_output_event_publisher",
    });
  }

  async publish(event: OutputEvent): Promise<OutputReceipt> {
    const initialIdentity = getOutputLogIdentity(event);
    this.logger.debug("conversation.output.publish_started", {
      ...initialIdentity,
    });

    let snapshot: OutputEventSnapshot;
    try {
      snapshot = this.captureAndValidateSnapshot(event);
    } catch (error) {
      const reason = getRejectionReason(error);
      this.logger.info("conversation.output.rejected", {
        ...initialIdentity,
        rejectionReason: reason,
        ...getErrorIdentity(error),
      });
      throw new ConversationOutputRejectedError(
        initialIdentity.conversationId,
        initialIdentity.outputEventId,
        initialIdentity.eventType,
        reason,
      );
    }

    const identity = getSnapshotLogIdentity(snapshot);
    let result: ConversationJournalAppendResult;
    try {
      result = await this.journalService.append({
        direction: "output",
        snapshot,
      });
      validateAppendResult(result, snapshot);
    } catch (error) {
      if (error instanceof JournalEventConflictError) {
        this.logger.warn("conversation.output.conflict", { ...identity });
        throw new ConversationOutputConflictError(
          identity.conversationId,
          identity.outputEventId,
          identity.eventType,
        );
      }
      const errorIdentity = getErrorIdentity(error);
      this.logger.error("conversation.output.persistence_failed", {
        ...identity,
        ...errorIdentity,
      });
      throw new ConversationOutputPersistenceError(
        identity.conversationId,
        identity.outputEventId,
        identity.eventType,
        errorIdentity.errorName,
        errorIdentity.errorCode,
      );
    }

    const receipt = createOutputReceipt(result);
    if (receipt.status === OUTPUT_RECEIPT_STATUS.duplicate) {
      this.logger.debug("conversation.output.duplicate", {
        ...identity,
        sequence: receipt.sequence,
      });
      return receipt;
    }

    this.logger.info("conversation.output.recorded", {
      ...identity,
      sequence: receipt.sequence,
      livePublicationStatus: result.livePublication.status,
    });
    if (result.livePublication.status === "failed") {
      this.logger.warn("conversation.output.live_publication_failed", {
        ...identity,
        sequence: receipt.sequence,
        errorName: result.livePublication.errorName,
        ...(result.livePublication.errorCode !== undefined
          ? { errorCode: result.livePublication.errorCode }
          : {}),
      });
    }
    return receipt;
  }

  private captureAndValidateSnapshot(event: OutputEvent): OutputEventSnapshot {
    const validated = this.eventSchemaRegistry.validateOutput(event.getSnapshot());
    const canonical = canonicalStringifyJson(validated as unknown as JsonValue);
    return deepFreezeJson(JSON.parse(canonical)) as OutputEventSnapshot;
  }
}

function createOutputReceipt(
  result: ConversationJournalAppendResult,
): OutputReceipt {
  return Object.freeze({
    status:
      result.receipt.status === "appended"
        ? OUTPUT_RECEIPT_STATUS.recorded
        : OUTPUT_RECEIPT_STATUS.duplicate,
    conversationId: result.receipt.conversationId,
    outputEventId: result.receipt.eventId,
    sequence: result.receipt.sequence,
    recordedAt: result.receipt.recordedAt,
  });
}

function validateAppendResult(
  result: ConversationJournalAppendResult,
  snapshot: OutputEventSnapshot,
): void {
  if (result === null || typeof result !== "object") {
    throw new TypeError("Conversation Journal append result must be an object");
  }
  const { receipt } = result;
  if (receipt === null || typeof receipt !== "object") {
    throw new TypeError("Conversation Journal append receipt must be an object");
  }
  if (receipt.status !== "appended" && receipt.status !== "duplicate") {
    throw new TypeError("Conversation Journal append receipt status is invalid");
  }
  if (
    receipt.conversationId !== snapshot.conversationId ||
    receipt.eventId !== snapshot.id ||
    receipt.direction !== "output"
  ) {
    throw new TypeError("Conversation Journal append receipt identity is invalid");
  }
  if (!Number.isSafeInteger(receipt.sequence) || receipt.sequence <= 0) {
    throw new TypeError("Conversation Journal append receipt Sequence is invalid");
  }
  if (
    typeof receipt.recordedAt !== "string" ||
    Number.isNaN(Date.parse(receipt.recordedAt))
  ) {
    throw new TypeError("Conversation Journal append receipt timestamp is invalid");
  }
  if (
    result.livePublication?.status !== "published" &&
    result.livePublication?.status !== "skipped" &&
    result.livePublication?.status !== "failed"
  ) {
    throw new TypeError("Conversation Journal live publication result is invalid");
  }
}

function getRejectionReason(error: unknown): ConversationOutputRejectionReason {
  return error instanceof EventValidationError &&
    error.message.startsWith("Unknown output event schema:")
    ? "unknown_event_type"
    : "invalid_event";
}

function getOutputLogIdentity(event: OutputEvent): OutputLogIdentity {
  if (event === null || typeof event !== "object") {
    return {
      conversationId: "unknown",
      outputEventId: "unknown",
      eventType: "unknown",
    };
  }
  let eventType = "unknown";
  try {
    eventType = safeLogIdentifier(event.getEventType());
  } catch {
    eventType = "unknown";
  }
  return {
    conversationId: safeLogIdentifier(event.conversationId),
    outputEventId: safeLogIdentifier(event.id),
    eventType,
  };
}

function getSnapshotLogIdentity(snapshot: OutputEventSnapshot): OutputLogIdentity {
  return {
    conversationId: snapshot.conversationId,
    outputEventId: snapshot.id,
    eventType: snapshot.eventType,
  };
}

function safeLogIdentifier(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value : "unknown";
}

function getErrorIdentity(error: unknown): Readonly<{
  errorName: string;
  errorCode?: string;
}> {
  if (error === null || typeof error !== "object") {
    return { errorName: "UnknownError" };
  }
  const candidate = error as { name?: unknown; code?: unknown };
  const errorName =
    typeof candidate.name === "string" && candidate.name.trim().length > 0
      ? candidate.name
      : "UnknownError";
  return typeof candidate.code === "string" && candidate.code.trim().length > 0
    ? { errorName, errorCode: candidate.code }
    : { errorName };
}

function deepFreezeJson<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
}
