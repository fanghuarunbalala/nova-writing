/** Deterministic protocol/state-machine backend shared by every Mock client Transport. */
import {
  coreEventSchemaRegistry,
  EventValidationError,
  type InputEventSnapshot,
  type InputReceipt,
  type OutputEventSnapshot,
} from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type {
  ConversationEventSubscription,
  ConversationJournalAppendResult,
  ConversationStatus,
  JournalAppendRequest,
  PersistedConversationEventSnapshot,
} from "../../storage/index.js";
import {
  ConversationEventQueryError,
  InMemoryConversationEventHub,
  JournalConversationEventSubscriptionService,
  JournalConversationNotAcceptingInputError,
  JournalConversationNotFoundError,
  JournalEventConflictError,
  PublishingConversationJournalService,
} from "../../storage/index.js";
import {
  API_PROTOCOL_VERSION,
  type ApiErrorSnapshot,
  type ApiRequest,
  type ApiResponse,
  type ApiSubscriptionOptions,
} from "../../transport/index.js";
import type { ConversationSnapshot } from "../../conversation/ConversationSnapshot.js";
import type { RuntimePresence } from "../../conversation/RuntimePresence.js";
import type { ConversationEventListOptions } from "../../conversation/ConversationEvents.js";
import type { ConversationComposeState } from "../../storage/index.js";
import {
  CONVERSATION_API_OPERATION,
  type SerializableConversationEventSubscriptionOptions,
} from "../../conversation/client/index.js";
import {
  DeterministicMockClock,
  type MockNovelHostClock,
} from "./DeterministicMockClock.js";
import { InMemoryMockConversationJournal } from "./InMemoryMockConversationJournal.js";

interface MockConversationState {
  snapshot: ConversationSnapshot;
  runtimePresence: RuntimePresence;
  composeState?: ConversationComposeState;
}

export interface RegisterMockConversationOptions {
  readonly snapshot: ConversationSnapshot;
  readonly runtimePresence?: RuntimePresence;
  /** 可选的活跃 compose 会话子状态；缺省为无。 */
  /** Optional active compose session sub-state; absent by default. */
  readonly composeState?: ConversationComposeState;
}

export interface DeterministicMockNovelHostOptions {
  readonly clock?: MockNovelHostClock;
  readonly logger?: Logger;
}

export class DeterministicMockNovelHost {
  private readonly clock: MockNovelHostClock;
  private readonly logger: Logger;
  private readonly journal: InMemoryMockConversationJournal;
  private readonly hub: InMemoryConversationEventHub;
  private readonly journalService: PublishingConversationJournalService;
  private readonly subscriptionService: JournalConversationEventSubscriptionService;
  private readonly conversations = new Map<string, MockConversationState>();
  private closed = false;
  private closePromise?: Promise<void>;

  constructor(options: DeterministicMockNovelHostOptions = {}) {
    this.clock = options.clock ?? new DeterministicMockClock();
    this.logger = (options.logger ?? noopLogger).child({
      component: "deterministic_mock_novel_host",
    });
    this.journal = new InMemoryMockConversationJournal({ clock: this.clock });
    this.hub = new InMemoryConversationEventHub({ logger: this.logger });
    this.journalService = new PublishingConversationJournalService({
      journal: this.journal,
      hub: this.hub,
      logger: this.logger,
    });
    this.subscriptionService = new JournalConversationEventSubscriptionService({
      journal: this.journal,
      hub: this.hub,
      logger: this.logger,
    });
  }

  registerConversation(options: RegisterMockConversationOptions): void {
    this.assertOpen();
    const snapshot = cloneConversationSnapshot(options.snapshot);
    const conversationId = snapshot.metadata.id;
    if (snapshot.metadata.lastJournalSequence !== 0) {
      throw new TypeError(
        "Mock Conversation must start at Journal sequence zero and be seeded through appendEvent()",
      );
    }
    if (this.conversations.has(conversationId)) {
      throw new TypeError("Mock Conversation is already registered");
    }
    const runtimePresence = cloneRuntimePresence(
      options.runtimePresence ?? {
        state: "offline",
        observedAt: snapshot.metadata.updatedAt,
      },
    );
    this.journal.registerConversation(conversationId, snapshot.metadata.status);
    this.conversations.set(conversationId, {
      snapshot,
      runtimePresence,
      ...(options.composeState === undefined
        ? {}
        : { composeState: cloneComposeState(options.composeState) }),
    });
    this.logger.info("mock_novel_host.conversation_registered", {
      conversationId,
      status: snapshot.metadata.status,
      runtimePresence: runtimePresence.state,
    });
  }

  setConversationStatus(
    conversationId: string,
    status: ConversationStatus,
  ): void {
    this.assertOpen();
    const state = this.requireConversation(conversationId);
    this.journal.setConversationStatus(conversationId, status);
    state.snapshot = Object.freeze({
      metadata: Object.freeze({
        ...state.snapshot.metadata,
        status,
        updatedAt: this.clock.now(),
      }),
      activeAgentBinding: state.snapshot.activeAgentBinding,
    });
  }

  setRuntimePresence(
    conversationId: string,
    presence: RuntimePresence,
  ): void {
    this.assertOpen();
    this.requireConversation(conversationId).runtimePresence =
      cloneRuntimePresence(presence);
    this.logger.debug("mock_novel_host.runtime_presence_updated", {
      conversationId,
      state: presence.state,
    });
  }

  async appendInput(
    snapshot: InputEventSnapshot,
  ): Promise<InputReceipt> {
    const result = await this.appendEvent({ direction: "input", snapshot });
    return Object.freeze({
      status: result.receipt.status === "appended" ? "accepted" : "duplicate",
      conversationId: result.receipt.conversationId,
      inputEventId: result.receipt.eventId,
      sequence: result.receipt.sequence,
      acceptedAt: result.receipt.recordedAt,
    });
  }

  async appendOutput(
    snapshot: OutputEventSnapshot,
  ): Promise<PersistedConversationEventSnapshot> {
    return (await this.appendEvent({ direction: "output", snapshot })).event;
  }

  async appendEvent(
    request: JournalAppendRequest,
  ): Promise<ConversationJournalAppendResult> {
    this.assertOpen();
    this.requireConversation(request.snapshot.conversationId);
    const result = await this.journalService.append(request);
    this.advanceConversationSnapshot(
      request.snapshot.conversationId,
      result.receipt.sequence,
      result.receipt.recordedAt,
    );
    this.logger.debug("mock_novel_host.event_appended", {
      conversationId: result.receipt.conversationId,
      eventId: result.receipt.eventId,
      direction: result.receipt.direction,
      sequence: result.receipt.sequence,
      status: result.receipt.status,
    });
    return result;
  }

  async request(request: ApiRequest): Promise<ApiResponse> {
    this.assertOpen();
    const requestId = assertNonEmptyString(request.requestId, "API request id");
    try {
      if (request.protocolVersion !== API_PROTOCOL_VERSION) {
        throw new MockNovelHostProtocolError("API request protocol version is incompatible");
      }
      const data = await this.dispatchRequest(request);
      this.logger.debug("mock_novel_host.request_completed", {
        requestId,
        operation: request.operation,
      });
      return Object.freeze({
        protocolVersion: API_PROTOCOL_VERSION,
        requestId,
        ok: true,
        data,
      });
    } catch (error) {
      const snapshot = createApiErrorSnapshot(error);
      this.logger.info("mock_novel_host.request_rejected", {
        requestId,
        operation: request.operation,
        errorCode: snapshot.code,
        errorCategory: snapshot.category,
        retryable: snapshot.retryable,
      });
      return Object.freeze({
        protocolVersion: API_PROTOCOL_VERSION,
        requestId,
        ok: false,
        error: snapshot,
      });
    }
  }

  subscribe(
    request: ApiRequest,
    options: ApiSubscriptionOptions = {},
  ): ConversationEventSubscription {
    this.assertOpen();
    if (request.protocolVersion !== API_PROTOCOL_VERSION) {
      throw new MockNovelHostProtocolError("API request protocol version is incompatible");
    }
    if (request.operation !== CONVERSATION_API_OPERATION.eventsSubscribe) {
      throw new MockNovelHostProtocolError("API operation does not create a subscription");
    }
    const payload = assertRecord(request.payload, "Subscription request payload");
    const conversationId = assertNonEmptyString(
      payload.conversationId,
      "Subscription Conversation id",
    );
    this.requireConversation(conversationId);
    const subscriptionOptions = cloneSubscriptionOptions(
      assertRecord(payload.options, "Conversation subscription options"),
    );
    const subscription = this.subscriptionService.subscribe({
      conversationId,
      ...subscriptionOptions,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    this.logger.info("mock_novel_host.subscription_opened", {
      requestId: request.requestId,
      conversationId,
      subscriptionId: subscription.id,
    });
    return subscription;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async dispatchRequest(request: ApiRequest): Promise<unknown> {
    const payload = assertRecord(request.payload, "API request payload");
    const conversationId = assertNonEmptyString(
      payload.conversationId,
      "Conversation id",
    );
    const state = this.requireConversation(conversationId);

    switch (request.operation) {
      case CONVERSATION_API_OPERATION.snapshotGet:
        return state.snapshot;
      case CONVERSATION_API_OPERATION.runtimePresenceGet:
        return state.runtimePresence;
      case CONVERSATION_API_OPERATION.composeStateGet:
        return state.composeState ?? null;
      case CONVERSATION_API_OPERATION.inputEnqueue: {
        const inputEvent = coreEventSchemaRegistry.validateInput(
          payload.inputEvent,
          { allowUnknownEventType: true },
        );
        if (inputEvent.conversationId !== conversationId) {
          throw new MockNovelHostProtocolError(
            "InputEvent targets another Conversation",
          );
        }
        return this.appendInput(inputEvent);
      }
      case CONVERSATION_API_OPERATION.eventsList: {
        const listOptions = assertRecord(
          payload.options,
          "Conversation Event list options",
        );
        return this.journal.list({
          ...(listOptions as unknown as ConversationEventListOptions),
          conversationId,
        });
      }
      default:
        throw new MockNovelHostProtocolError("API operation is not supported by Mock Host");
    }
  }

  private advanceConversationSnapshot(
    conversationId: string,
    sequence: number,
    recordedAt: string,
  ): void {
    const state = this.requireConversation(conversationId);
    if (sequence <= state.snapshot.metadata.lastJournalSequence) return;
    state.snapshot = Object.freeze({
      metadata: Object.freeze({
        ...state.snapshot.metadata,
        lastJournalSequence: sequence,
        updatedAt: recordedAt,
      }),
      activeAgentBinding: state.snapshot.activeAgentBinding,
    });
  }

  private requireConversation(conversationId: string): MockConversationState {
    const state = this.conversations.get(conversationId);
    if (state === undefined) {
      throw new JournalConversationNotFoundError(conversationId);
    }
    return state;
  }

  private assertOpen(): void {
    if (this.closed) throw new MockNovelHostClosedError();
  }

  private async closeOnce(): Promise<void> {
    this.closed = true;
    this.logger.info("mock_novel_host.close_started", {
      conversationCount: this.conversations.size,
    });
    const results = await Promise.allSettled([
      this.subscriptionService.close(),
      this.journalService.close(),
    ]);
    await this.hub.close();
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    this.logger.info("mock_novel_host.close_completed", {
      errorCount: errors.length,
    });
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "Failed to close deterministic Mock Novel Host");
    }
  }
}

export class MockNovelHostProtocolError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "MockNovelHostProtocolError";
  }
}

export class MockNovelHostClosedError extends Error {
  constructor() {
    super("Mock Novel Host is closed");
    this.name = "MockNovelHostClosedError";
  }
}

function createApiErrorSnapshot(error: unknown): ApiErrorSnapshot {
  if (error instanceof JournalConversationNotFoundError) {
    return freezeError("CONVERSATION_NOT_FOUND", "not-found", false, "Conversation was not found");
  }
  if (error instanceof JournalConversationNotAcceptingInputError) {
    return freezeError(
      "CONVERSATION_NOT_ACCEPTING_INPUT",
      "conflict",
      false,
      "Conversation is not accepting input",
    );
  }
  if (error instanceof JournalEventConflictError) {
    return freezeError("EVENT_ID_CONFLICT", "conflict", false, "Event identity conflicts with durable history");
  }
  if (
    error instanceof MockNovelHostProtocolError ||
    error instanceof EventValidationError ||
    error instanceof ConversationEventQueryError
  ) {
    return freezeError("INVALID_API_REQUEST", "validation", false, "API request is invalid");
  }
  if (error instanceof MockNovelHostClosedError) {
    return freezeError("HOST_UNAVAILABLE", "unavailable", true, "Host is unavailable");
  }
  return freezeError("INTERNAL_ERROR", "internal", false, "An internal Host error occurred");
}

function freezeError(
  code: string,
  category: ApiErrorSnapshot["category"],
  retryable: boolean,
  message: string,
): ApiErrorSnapshot {
  return Object.freeze({ code, category, retryable, message });
}

function cloneConversationSnapshot(snapshot: ConversationSnapshot): ConversationSnapshot {
  if (snapshot.metadata.id !== snapshot.activeAgentBinding.conversationId) {
    throw new TypeError("Mock Conversation Snapshot identities do not match");
  }
  return Object.freeze({
    metadata: Object.freeze({ ...snapshot.metadata }),
    activeAgentBinding: Object.freeze({ ...snapshot.activeAgentBinding }),
  });
}

function cloneRuntimePresence(presence: RuntimePresence): RuntimePresence {
  return Object.freeze({ ...presence });
}

function cloneComposeState(state: ConversationComposeState): ConversationComposeState {
  return Object.freeze({ ...state });
}

function cloneSubscriptionOptions(
  value: Record<string, unknown>,
): SerializableConversationEventSubscriptionOptions {
  return JSON.parse(JSON.stringify(value)) as SerializableConversationEventSubscriptionOptions;
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MockNovelHostProtocolError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MockNovelHostProtocolError(`${label} must be a non-empty string`);
  }
  return value;
}
