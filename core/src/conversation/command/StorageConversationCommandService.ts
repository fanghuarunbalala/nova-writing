/**
 * Validates and durably accepts Conversation inputs before notifying the Host.
 *
 * @example
 * ```ts
 * const service = new StorageConversationCommandService({
 *   metadataStore,
 *   journalService,
 *   eventSchemaRegistry,
 *   routePolicy,
 *   acceptedInputNotifier,
 * });
 * const receipt = await service.enqueue(conversationId, inputEvent);
 * ```
 */
import {
  EventValidationError,
  InputRejectedError,
  type EventSchemaRegistry,
  type InputEvent,
  type InputEventSnapshot,
  type InputReceipt,
} from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  JournalConversationNotAcceptingInputError,
  JournalConversationNotFoundError,
  JournalEventConflictError,
  type ConversationJournalAppendResult,
  type ConversationJournalService,
  type ConversationMetadataStore,
} from "../../storage/index.js";
import type { ConversationCommandService } from "../ConversationCommandService.js";
import type { AcceptedConversationInputNotifier } from "./AcceptedConversationInputNotifier.js";
import type { AcceptedConversationInputSignal } from "./AcceptedConversationInputSignal.js";
import type { ConversationInputRoute } from "./ConversationInputRoute.js";
import type { ConversationInputRoutePolicy } from "./ConversationInputRoutePolicy.js";

export interface StorageConversationCommandServiceOptions {
  metadataStore: ConversationMetadataStore;
  journalService: ConversationJournalService;
  eventSchemaRegistry: EventSchemaRegistry;
  routePolicy: ConversationInputRoutePolicy;
  acceptedInputNotifier: AcceptedConversationInputNotifier;
  logger?: Logger;
}

export class StorageConversationCommandService
  implements ConversationCommandService
{
  private readonly metadataStore: ConversationMetadataStore;
  private readonly journalService: ConversationJournalService;
  private readonly eventSchemaRegistry: EventSchemaRegistry;
  private readonly routePolicy: ConversationInputRoutePolicy;
  private readonly acceptedInputNotifier: AcceptedConversationInputNotifier;
  private readonly logger: Logger;

  constructor(options: StorageConversationCommandServiceOptions) {
    this.metadataStore = options.metadataStore;
    this.journalService = options.journalService;
    this.eventSchemaRegistry = options.eventSchemaRegistry;
    this.routePolicy = options.routePolicy;
    this.acceptedInputNotifier = options.acceptedInputNotifier;
    this.logger = options.logger ?? noopLogger;
  }

  async enqueue(conversationId: string, event: InputEvent): Promise<InputReceipt> {
    const snapshot = this.captureAndValidateSnapshot(conversationId, event);
    const { id: inputEventId, eventType } = snapshot;
    this.logger.debug("conversation.command.enqueue_started", {
      conversationId,
      inputEventId,
      eventType,
    });

    await this.assertConversationExists(conversationId, inputEventId, eventType);
    const route = this.routePolicy.resolve(snapshot);

    let result: ConversationJournalAppendResult;
    try {
      result = await this.journalService.append({ direction: "input", snapshot });
    } catch (error) {
      throw this.normalizeJournalError(error, conversationId, inputEventId, eventType);
    }

    const receipt = this.createInputReceipt(result);
    this.logger.info(
      result.receipt.status === "duplicate"
        ? "conversation.command.input_duplicate"
        : "conversation.command.input_persisted",
      {
        conversationId,
        inputEventId,
        eventType,
        sequence: result.receipt.sequence,
        livePublicationStatus: result.livePublication.status,
        routeTarget: route.target,
      },
    );

    const signal = this.createAcceptedSignal(snapshot, result, route);
    try {
      await this.acceptedInputNotifier.notifyAccepted(signal);
      this.logger.debug("conversation.command.host_notified", {
        conversationId,
        inputEventId,
        eventType,
        sequence: result.receipt.sequence,
        journalStatus: result.receipt.status,
        routeTarget: route.target,
      });
    } catch (error) {
      this.logger.warn("conversation.command.host_notification_failed", {
        conversationId,
        inputEventId,
        eventType,
        sequence: result.receipt.sequence,
        journalStatus: result.receipt.status,
        routeTarget: route.target,
        ...getErrorIdentity(error),
      });
    }

    return receipt;
  }

  private captureAndValidateSnapshot(
    conversationId: string,
    event: InputEvent,
  ): InputEventSnapshot {
    try {
      return this.eventSchemaRegistry.validateInput(event.getSnapshot(conversationId));
    } catch (error) {
      if (error instanceof InputRejectedError) throw error;
      if (error instanceof EventValidationError) {
        const code = error.message.startsWith("Unknown input event schema:")
          ? "unknown_event_type"
          : "invalid_event";
        this.logger.info("conversation.command.input_rejected", {
          conversationId,
          inputEventId: event.id,
          eventType: event.getEventType(),
          rejectionCode: code,
        });
        throw new InputRejectedError(code, `Input event was rejected: ${code}`);
      }
      throw error;
    }
  }

  private async assertConversationExists(
    conversationId: string,
    inputEventId: string,
    eventType: string,
  ): Promise<void> {
    const metadata = await this.metadataStore.getConversationMetadata(conversationId);
    if (metadata === undefined) {
      this.logRejection(conversationId, inputEventId, eventType, "conversation_not_found");
      throw new InputRejectedError(
        "conversation_not_found",
        `Conversation was not found: ${conversationId}`,
      );
    }
  }

  private normalizeJournalError(
    error: unknown,
    conversationId: string,
    inputEventId: string,
    eventType: string,
  ): unknown {
    if (error instanceof JournalConversationNotFoundError) {
      this.logRejection(conversationId, inputEventId, eventType, "conversation_not_found");
      return new InputRejectedError(
        "conversation_not_found",
        `Conversation was not found: ${conversationId}`,
      );
    }
    if (error instanceof JournalConversationNotAcceptingInputError) {
      this.logRejection(
        conversationId,
        inputEventId,
        eventType,
        "conversation_not_accepting_input",
      );
      return new InputRejectedError(
        "conversation_not_accepting_input",
        `Conversation is not accepting input: ${conversationId}`,
      );
    }
    if (error instanceof JournalEventConflictError) {
      this.logRejection(conversationId, inputEventId, eventType, "event_id_conflict");
      return new InputRejectedError(
        "event_id_conflict",
        `Input event ID conflicts with a durable event: ${inputEventId}`,
      );
    }
    return error;
  }

  private createInputReceipt(result: ConversationJournalAppendResult): InputReceipt {
    return Object.freeze({
      status: result.receipt.status === "appended" ? "accepted" : "duplicate",
      conversationId: result.receipt.conversationId,
      inputEventId: result.receipt.eventId,
      sequence: result.receipt.sequence,
      acceptedAt: result.receipt.recordedAt,
    });
  }

  private createAcceptedSignal(
    snapshot: InputEventSnapshot,
    result: ConversationJournalAppendResult,
    route: ConversationInputRoute,
  ): AcceptedConversationInputSignal {
    return Object.freeze({
      conversationId: snapshot.conversationId,
      inputEventId: snapshot.id,
      eventType: snapshot.eventType,
      priority: snapshot.priority,
      sequence: result.receipt.sequence,
      recordedAt: result.receipt.recordedAt,
      journalStatus: result.receipt.status,
      route,
      ...(snapshot.correlationId !== undefined
        ? { correlationId: snapshot.correlationId }
        : {}),
      ...(snapshot.runId !== undefined ? { runId: snapshot.runId } : {}),
      ...(snapshot.turnId !== undefined ? { turnId: snapshot.turnId } : {}),
    });
  }

  private logRejection(
    conversationId: string,
    inputEventId: string,
    eventType: string,
    rejectionCode: string,
  ): void {
    this.logger.info("conversation.command.input_rejected", {
      conversationId,
      inputEventId,
      eventType,
      rejectionCode,
    });
  }
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
