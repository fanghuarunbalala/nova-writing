/** Parent-side allowlisted persistence RPC Handler over existing typed Stores. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import type {
  ContextCheckpointStore,
  InteractionCoordinator,
  PendingNudgeStore,
} from "../../../runtime/index.js";
import {
  RUNTIME_PERSISTENCE_RPC_METHOD,
  RUNTIME_RECOVERY_SNAPSHOT_SCHEMA_VERSION,
  RuntimePersistenceProtocolError,
  captureRuntimeJournalAppendOutputRequest,
  captureRuntimeJournalAppendOutputReceipt,
  captureRuntimeJournalGetEventRequest,
  captureRuntimeJournalGetEventResponse,
  captureRuntimeJournalListEventsRequest,
  captureRuntimeJournalListEventsResponse,
  captureRuntimeMessagesListRequest,
  captureRuntimeMessagesListResponse,
  captureRuntimeRecoverySnapshot,
  captureRuntimeStateLoadRequest,
  encodeRuntimePersistencePayload,
  isRuntimePersistenceRpcMethod,
  type RuntimeIpcErrorSnapshot,
  type RuntimeIpcRequestErrorMapper,
  type RuntimeIpcRequestHandler,
  type RuntimeIpcRequestHandlerContext,
  type RuntimePersistenceRpcMethod,
} from "../../../runtime/ipc/index.js";
import type {
  ConversationJournalReader,
  ConversationJournalService,
  ConversationMessageFileStore,
} from "../../../storage/index.js";
import type { JsonValue } from "../../../event/index.js";

export interface ParentRuntimePersistenceHandlerOptions {
  readonly conversationId: string;
  readonly journalReader: ConversationJournalReader;
  readonly journalService: ConversationJournalService;
  readonly messageStore: Pick<ConversationMessageFileStore, "list">;
  readonly pendingNudgeStore?: Pick<PendingNudgeStore, "snapshot">;
  readonly contextCheckpointStore?: Pick<ContextCheckpointStore, "getActive">;
  readonly interactionCoordinator?: Pick<InteractionCoordinator, "snapshot">;
  readonly logger?: Logger;
}

export class ParentRuntimePersistenceHandler
  implements RuntimeIpcRequestHandler, RuntimeIpcRequestErrorMapper
{
  readonly #conversationId: string;
  readonly #journalReader: ConversationJournalReader;
  readonly #journalService: ConversationJournalService;
  readonly #messageStore: Pick<ConversationMessageFileStore, "list">;
  readonly #pendingNudgeStore?: Pick<PendingNudgeStore, "snapshot">;
  readonly #contextCheckpointStore?: Pick<ContextCheckpointStore, "getActive">;
  readonly #interactionCoordinator?: Pick<InteractionCoordinator, "snapshot">;
  readonly #logger: Logger;

  constructor(options: ParentRuntimePersistenceHandlerOptions) {
    this.#conversationId = captureIdentity(options.conversationId);
    this.#journalReader = options.journalReader;
    this.#journalService = options.journalService;
    this.#messageStore = options.messageStore;
    this.#pendingNudgeStore = options.pendingNudgeStore;
    this.#contextCheckpointStore = options.contextCheckpointStore;
    this.#interactionCoordinator = options.interactionCoordinator;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "parent_runtime_persistence_handler",
      conversationId: this.#conversationId,
    });
  }

  async handle(
    method: string,
    payload: JsonValue,
    context: RuntimeIpcRequestHandlerContext,
  ): Promise<JsonValue> {
    if (!isRuntimePersistenceRpcMethod(method)) {
      throw new RuntimePersistenceProtocolError("method_not_allowed");
    }
    this.#logger.debug("runtime.persistence.request_started", {
      method,
      requestId: context.requestId,
    });
    const response = await this.#dispatch(method, payload, context.signal);
    this.#logger.debug("runtime.persistence.request_completed", {
      method,
      requestId: context.requestId,
    });
    return response;
  }

  map(error: unknown, context: RuntimeIpcRequestHandlerContext): RuntimeIpcErrorSnapshot {
    if (context.signal.aborted || error instanceof RuntimePersistenceAbortError) {
      return Object.freeze({
        code: "RUNTIME_PERSISTENCE_CANCELLED",
        category: "cancelled",
        retryable: false,
      });
    }
    if (error instanceof RuntimePersistenceProtocolError) {
      return Object.freeze({
        code: error.failure === "method_not_allowed"
          ? "RUNTIME_PERSISTENCE_METHOD_NOT_ALLOWED"
          : "RUNTIME_PERSISTENCE_PROTOCOL_INVALID",
        category: error.failure === "identity_mismatch" || error.failure === "sequence_mismatch"
          ? "conflict"
          : error.failure === "method_not_allowed"
            ? "protocol"
            : "validation",
        retryable: false,
      });
    }
    return Object.freeze({
      code: "RUNTIME_PERSISTENCE_UNAVAILABLE",
      category: "unavailable",
      retryable: true,
    });
  }

  async #dispatch(
    method: RuntimePersistenceRpcMethod,
    payload: JsonValue,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    switch (method) {
      case RUNTIME_PERSISTENCE_RPC_METHOD.journalGetEvent:
        return this.#getEvent(payload, signal);
      case RUNTIME_PERSISTENCE_RPC_METHOD.journalListEvents:
        return this.#listEvents(payload, signal);
      case RUNTIME_PERSISTENCE_RPC_METHOD.journalAppendOutput:
        return this.#appendOutput(payload, signal);
      case RUNTIME_PERSISTENCE_RPC_METHOD.messagesList:
        return this.#listMessages(payload, signal);
      case RUNTIME_PERSISTENCE_RPC_METHOD.runtimeStateLoad:
        return this.#loadRuntimeState(payload, signal);
    }
  }

  async #getEvent(payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = captureRuntimeJournalGetEventRequest(payload);
    this.#assertConversation(request.conversationId);
    const event = await abortable(
      this.#journalReader.getBySequence(request.conversationId, request.sequence),
      signal,
    );
    const response = captureRuntimeJournalGetEventResponse(
      event === undefined ? { found: false } : { found: true, event },
      request,
    );
    return encodeRuntimePersistencePayload(response);
  }

  async #listEvents(payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = captureRuntimeJournalListEventsRequest(payload);
    this.#assertConversation(request.conversationId);
    const page = await abortable(this.#journalReader.list(request), signal);
    return encodeRuntimePersistencePayload(
      captureRuntimeJournalListEventsResponse(page, request),
    );
  }

  async #appendOutput(payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = captureRuntimeJournalAppendOutputRequest(payload);
    this.#assertConversation(request.conversationId);
    const result = await abortable(
      this.#journalService.append({ direction: "output", snapshot: request.snapshot }),
      signal,
    );
    const receipt = captureRuntimeJournalAppendOutputReceipt(
      {
        status: result.receipt.status,
        conversationId: result.receipt.conversationId,
        eventId: result.receipt.eventId,
        sequence: result.receipt.sequence,
        recordedAt: result.receipt.recordedAt,
      },
      request,
    );
    this.#logger.info("runtime.persistence.output_durable", {
      eventId: receipt.eventId,
      eventType: request.snapshot.eventType,
      sequence: receipt.sequence,
      status: receipt.status,
    });
    return encodeRuntimePersistencePayload(receipt);
  }

  async #listMessages(payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = captureRuntimeMessagesListRequest(payload);
    this.#assertConversation(request.conversationId);
    const page = await abortable(this.#messageStore.list(request), signal);
    return encodeRuntimePersistencePayload(
      captureRuntimeMessagesListResponse(page, request),
    );
  }

  async #loadRuntimeState(payload: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    const request = captureRuntimeStateLoadRequest(payload);
    this.#assertConversation(request.conversationId);
    const capturedThroughSequence = await abortable(
      this.#journalReader.getHighWatermark(request.conversationId),
      signal,
    );
    const [nudge, contextCheckpoint, interaction] = await abortable(
      Promise.all([
        this.#pendingNudgeStore?.snapshot(),
        this.#contextCheckpointStore?.getActive(request.conversationId),
        this.#interactionCoordinator?.snapshot(),
      ]),
      signal,
    );
    const snapshot = captureRuntimeRecoverySnapshot({
      schemaVersion: RUNTIME_RECOVERY_SNAPSHOT_SCHEMA_VERSION,
      conversationId: request.conversationId,
      capturedThroughSequence,
      ...(nudge === undefined ? {} : { nudge }),
      ...(contextCheckpoint === undefined ? {} : { contextCheckpoint }),
      ...(interaction === undefined ? {} : { interaction }),
    }, request.conversationId);
    this.#logger.info("runtime.persistence.recovery_loaded", {
      capturedThroughSequence,
      hasNudge: nudge !== undefined,
      hasContextCheckpoint: contextCheckpoint !== undefined,
      hasInteraction: interaction !== undefined,
    });
    return encodeRuntimePersistencePayload(snapshot);
  }

  #assertConversation(conversationId: string): void {
    if (conversationId !== this.#conversationId) {
      throw new RuntimePersistenceProtocolError("identity_mismatch");
    }
  }
}

class RuntimePersistenceAbortError extends Error {
  constructor() {
    super("Runtime persistence operation was cancelled");
    this.name = "RuntimePersistenceAbortError";
  }
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new RuntimePersistenceAbortError());
  return new Promise<T>((resolve, reject) => {
    const cancelled = () => reject(new RuntimePersistenceAbortError());
    signal.addEventListener("abort", cancelled, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener("abort", cancelled);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", cancelled);
        reject(error);
      },
    );
  });
}

function captureIdentity(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
  ) {
    throw new TypeError("Runtime persistence Conversation identity is invalid");
  }
  return value;
}
