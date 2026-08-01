/**
 * Persists Conversation Events before publishing them to the process-local
 * live Event Hub.
 *
 * @example
 * ```ts
 * const service = new PublishingConversationJournalService({ journal, hub });
 * const result = await service.append({ direction: "input", snapshot });
 * ```
 */
import {
  canonicalStringifyJson,
  type JsonValue,
} from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type {
  ConversationJournalWriter,
  JournalAppendReceipt,
  JournalAppendRequest,
  PersistedConversationEventSnapshot,
} from "../index.js";
import { ConversationOperationSerializer } from "./ConversationOperationSerializer.js";
import type { ConversationEventHub } from "./ConversationEventHub.js";
import {
  ConversationJournalServiceClosedError,
  ConversationJournalServiceClosingError,
  ConversationJournalServiceReceiptError,
} from "./ConversationEventLiveErrors.js";
import type {
  ConversationEventLivePublication,
  ConversationJournalAppendResult,
} from "./ConversationJournalAppendResult.js";
import type { ConversationJournalService } from "./ConversationJournalService.js";

type ConversationJournalServiceState = "open" | "closing" | "closed";

interface ErrorIdentity {
  errorName: string;
  errorCode?: string;
}

export interface PublishingConversationJournalServiceOptions {
  journal: ConversationJournalWriter;
  hub: ConversationEventHub;
  logger?: Logger;
}

export class PublishingConversationJournalService
  implements ConversationJournalService
{
  private readonly journal: ConversationJournalWriter;
  private readonly hub: ConversationEventHub;
  private readonly logger: Logger;
  private readonly serializer = new ConversationOperationSerializer();
  private serviceState: ConversationJournalServiceState = "open";
  private pendingOperationCount = 0;
  private closePromise?: Promise<void>;

  constructor(options: PublishingConversationJournalServiceOptions) {
    this.journal = options.journal;
    this.hub = options.hub;
    this.logger = options.logger ?? noopLogger;
  }

  append(request: JournalAppendRequest): Promise<ConversationJournalAppendResult> {
    this.assertOpen();
    const capturedRequest = captureJournalAppendRequest(request);
    const { conversationId, id: eventId, eventType } = capturedRequest.snapshot;
    const { direction } = capturedRequest;
    this.pendingOperationCount += 1;
    this.logger.debug("conversation_journal.append.accepted", {
      conversationId,
      eventId,
      eventType,
      direction,
      pendingOperationCount: this.pendingOperationCount,
    });

    return this.serializer.run(conversationId, async () => {
      try {
        return await this.appendAndPublish(capturedRequest);
      } finally {
        this.pendingOperationCount -= 1;
        this.logger.debug("conversation_journal.append.settled", {
          conversationId,
          eventId,
          eventType,
          direction,
          pendingOperationCount: this.pendingOperationCount,
        });
      }
    });
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async appendAndPublish(
    request: JournalAppendRequest,
  ): Promise<ConversationJournalAppendResult> {
    const { conversationId, id: eventId, eventType } = request.snapshot;
    const { direction } = request;
    let receivedReceipt: JournalAppendReceipt;
    try {
      receivedReceipt = await this.journal.append(request);
    } catch (error) {
      this.logger.error("conversation_journal.append.failed", {
        conversationId,
        eventId,
        eventType,
        direction,
        ...getErrorIdentity(error),
      });
      throw error;
    }

    let receipt: JournalAppendReceipt;
    try {
      validateJournalAppendReceipt(receivedReceipt, request);
      receipt = Object.freeze({ ...receivedReceipt });
    } catch (error) {
      this.logger.error("conversation_journal.append.receipt_invalid", {
        conversationId,
        eventId,
        eventType,
        direction,
        ...getErrorIdentity(error),
      });
      throw error;
    }

    const event = createPersistedEvent(request, receipt);
    if (receipt.status === "duplicate") {
      this.logger.debug("conversation_journal.append.duplicate", {
        conversationId,
        eventId,
        eventType,
        direction,
        sequence: receipt.sequence,
      });
      return Object.freeze({
        receipt,
        event,
        livePublication: Object.freeze({
          status: "skipped",
          reason: "duplicate",
        }),
      });
    }

    const livePublication = await this.publishLive(event);
    return Object.freeze({ receipt, event, livePublication });
  }

  private async publishLive(
    event: PersistedConversationEventSnapshot,
  ): Promise<ConversationEventLivePublication> {
    try {
      await this.hub.publish(event);
      this.logger.debug("conversation_journal.live.published", {
        conversationId: event.conversationId,
        eventId: event.id,
        eventType: event.eventType,
        direction: event.direction,
        sequence: event.sequence,
      });
      return Object.freeze({ status: "published" });
    } catch (error) {
      const identity = getErrorIdentity(error);
      this.logger.warn("conversation_journal.live.failed", {
        conversationId: event.conversationId,
        eventId: event.id,
        eventType: event.eventType,
        direction: event.direction,
        sequence: event.sequence,
        ...identity,
      });
      return Object.freeze({
        status: "failed",
        ...identity,
      });
    }
  }

  private async closeOnce(): Promise<void> {
    this.serviceState = "closing";
    this.logger.info("conversation_journal.service.close_started", {
      pendingOperationCount: this.pendingOperationCount,
    });
    await this.serializer.drain();
    this.serviceState = "closed";
    this.logger.info("conversation_journal.service.close_completed", {
      pendingOperationCount: this.pendingOperationCount,
    });
  }

  private assertOpen(): void {
    if (this.serviceState === "closing") {
      throw new ConversationJournalServiceClosingError();
    }
    if (this.serviceState === "closed") {
      throw new ConversationJournalServiceClosedError();
    }
  }
}

function captureJournalAppendRequest(request: JournalAppendRequest): JournalAppendRequest {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("Journal append request must be an object");
  }
  if (request.direction !== "input" && request.direction !== "output") {
    throw new TypeError("Journal append request direction must be input or output");
  }

  const canonicalSnapshot = canonicalStringifyJson(
    request.snapshot as unknown as JsonValue,
  );
  const snapshot = deepFreezeJson(JSON.parse(canonicalSnapshot));
  return Object.freeze({
    direction: request.direction,
    snapshot,
  }) as JournalAppendRequest;
}

function createPersistedEvent(
  request: JournalAppendRequest,
  receipt: JournalAppendReceipt,
): PersistedConversationEventSnapshot {
  return Object.freeze({
    ...request.snapshot,
    direction: request.direction,
    sequence: receipt.sequence,
    recordedAt: receipt.recordedAt,
  }) as PersistedConversationEventSnapshot;
}

function validateJournalAppendReceipt(
  receipt: JournalAppendReceipt,
  request: JournalAppendRequest,
): void {
  if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new ConversationJournalServiceReceiptError("Journal append receipt must be an object");
  }
  if (receipt.status !== "appended" && receipt.status !== "duplicate") {
    throw new ConversationJournalServiceReceiptError("Journal append receipt status is invalid");
  }
  if (receipt.conversationId !== request.snapshot.conversationId) {
    throw new ConversationJournalServiceReceiptError(
      "Journal append receipt Conversation ID does not match the request",
    );
  }
  if (receipt.eventId !== request.snapshot.id) {
    throw new ConversationJournalServiceReceiptError(
      "Journal append receipt Event ID does not match the request",
    );
  }
  if (receipt.direction !== request.direction) {
    throw new ConversationJournalServiceReceiptError(
      "Journal append receipt direction does not match the request",
    );
  }
  if (!Number.isSafeInteger(receipt.sequence) || receipt.sequence < 1) {
    throw new ConversationJournalServiceReceiptError(
      "Journal append receipt Sequence must be a positive safe integer",
    );
  }
  if (
    typeof receipt.recordedAt !== "string" ||
    Number.isNaN(Date.parse(receipt.recordedAt))
  ) {
    throw new ConversationJournalServiceReceiptError(
      "Journal append receipt RecordedAt must be a valid timestamp",
    );
  }
}

function getErrorIdentity(error: unknown): ErrorIdentity {
  if (error === null || typeof error !== "object") {
    return { errorName: "UnknownError" };
  }

  const candidate = error as { name?: unknown; code?: unknown };
  const errorName =
    typeof candidate.name === "string" && candidate.name.trim().length > 0
      ? candidate.name
      : "UnknownError";
  if (typeof candidate.code !== "string" || candidate.code.trim().length === 0) {
    return { errorName };
  }
  return { errorName, errorCode: candidate.code };
}

function deepFreezeJson<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value)) {
    deepFreezeJson(child);
  }
  return Object.freeze(value);
}
