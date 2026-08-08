/** Routes the public Conversation API protocol to provider-neutral Core services. */
import {
  ConversationNotFoundError,
  type ConversationCatalogService,
  type ConversationCommandService,
  type ConversationComposeStateReader,
  type ConversationQueryService,
  type ConversationRuntimePresenceReader,
} from "../../conversation/index.js";
import {
  coreEventSchemaRegistry,
  EventPayload,
  EventValidationError,
  InputEvent,
  InputRejectedError,
  isJsonValue,
  type InputEventSnapshot,
  type JsonObject,
} from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  ConversationEventFilterError,
  ConversationEventHubClosedError,
  ConversationEventQueryError,
  ConversationEventSubscriptionAbortedError,
  ConversationEventSubscriptionCursorAheadError,
  ConversationEventSubscriptionOptionsError,
  ConversationEventSubscriptionOverflowError,
  ConversationAgentBindingMissingError,
  ConversationAlreadyExistsError,
  ConversationParentNotFoundError,
  ConversationWorkspaceMismatchError,
  type ConversationEventSubscription,
} from "../../storage/index.js";
import {
  API_PROTOCOL_VERSION,
  ApiTransportError,
  type ApiErrorSnapshot,
  type ApiEventFrame,
  type ApiRequest,
  type ApiRequestOptions,
  type ApiResponse,
  type ApiSubscription,
  type ApiSubscriptionOptions,
  type ApiTransport,
} from "../../transport/index.js";
import {
  CONVERSATION_API_OPERATION,
  type SerializableConversationEventSubscriptionOptions,
} from "../../conversation/client/ConversationApiOperations.js";

export interface ConversationApiRouterOptions {
  readonly catalog: ConversationCatalogService;
  readonly commands: ConversationCommandService;
  readonly queries: ConversationQueryService;
  readonly runtimePresence: ConversationRuntimePresenceReader;
  /** 可选 compose 会话子状态读取器；缺省时 composeStateGet 返回 undefined。 */
  /** Optional compose session sub-state reader; composeStateGet returns undefined when absent. */
  readonly composeStateReader?: ConversationComposeStateReader;
  readonly logger?: Logger;
}

export class ConversationApiRouter implements ApiTransport {
  private readonly catalog: ConversationCatalogService;
  private readonly commands: ConversationCommandService;
  private readonly queries: ConversationQueryService;
  private readonly runtimePresence: ConversationRuntimePresenceReader;
  private readonly composeStateReader?: ConversationComposeStateReader;
  private readonly logger: Logger;
  private readonly subscriptions = new Set<RoutedConversationApiSubscription>();
  private closed = false;
  private closePromise?: Promise<void>;

  constructor(options: ConversationApiRouterOptions) {
    this.catalog = options.catalog;
    this.commands = options.commands;
    this.queries = options.queries;
    this.runtimePresence = options.runtimePresence;
    this.composeStateReader = options.composeStateReader;
    this.logger = (options.logger ?? noopLogger).child({
      component: "conversation_api_router",
    });
  }

  async request<TData = unknown>(
    request: ApiRequest,
    options: ApiRequestOptions = {},
  ): Promise<ApiResponse<TData>> {
    this.assertOpen();
    throwIfAborted(options.signal);
    const requestId = captureRequestId(request);
    let operation = "invalid";
    try {
      operation = validateRequestEnvelope(request);
      this.logger.debug("conversation_api.request_started", {
        requestId,
        operation,
      });
      const data = await this.dispatch(request);
      throwIfAborted(options.signal);
      this.logger.debug("conversation_api.request_completed", {
        requestId,
        operation,
      });
      return Object.freeze({
        protocolVersion: API_PROTOCOL_VERSION,
        requestId,
        ok: true,
        data,
      }) as ApiResponse<TData>;
    } catch (error) {
      if (error instanceof ApiTransportError) throw error;
      const snapshot = createApiErrorSnapshot(error);
      this.logger.info("conversation_api.request_rejected", {
        requestId,
        operation,
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
  ): ApiSubscription {
    this.assertOpen();
    throwIfAborted(options.signal);
    try {
      const operation = validateRequestEnvelope(request);
      if (operation !== CONVERSATION_API_OPERATION.eventsSubscribe) {
        throw new ConversationApiRouterProtocolError(
          "API operation does not create a subscription",
        );
      }
      const payload = capturePayload(request.payload, ["conversationId", "options"]);
      const conversationId = captureConversationId(payload.conversationId);
      const subscriptionOptions = cloneJsonRecord(
        payload.options,
        "Conversation subscription options",
      ) as SerializableConversationEventSubscriptionOptions;
      const source = this.queries.subscribeEvents(conversationId, {
        ...subscriptionOptions,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
      let subscription: RoutedConversationApiSubscription;
      subscription = new RoutedConversationApiSubscription(
        source,
        this.logger,
        () => this.subscriptions.delete(subscription),
      );
      this.subscriptions.add(subscription);
      this.logger.info("conversation_api.subscription_opened", {
        requestId: request.requestId,
        operation,
        subscriptionId: subscription.id,
        subscriptionCount: this.subscriptions.size,
      });
      return subscription;
    } catch (error) {
      if (error instanceof ApiTransportError) throw error;
      throw createSubscriptionError(error);
    }
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async dispatch(request: ApiRequest): Promise<unknown> {
    const payload = capturePayload(request.payload, expectedPayloadKeys(request.operation));
    switch (request.operation) {
      case CONVERSATION_API_OPERATION.create:
        return this.catalog.create(captureCreateConversationOptions(payload.options));
      case CONVERSATION_API_OPERATION.list:
        return this.catalog.list(captureListConversationsOptions(payload.options));
      case CONVERSATION_API_OPERATION.rename:
        return this.catalog.rename(
          captureConversationId(payload.conversationId),
          captureNonBlank(payload.title, "Conversation title"),
        );
      case CONVERSATION_API_OPERATION.pin:
        return this.catalog.pin(
          captureConversationId(payload.conversationId),
          captureBoolean(payload.pinned),
        );
      case CONVERSATION_API_OPERATION.delete:
        await this.catalog.delete(captureConversationId(payload.conversationId));
        return Object.freeze({ deleted: true });
      case CONVERSATION_API_OPERATION.approvalsList:
        return Object.freeze({
          approvals: await this.queries.listApprovals(),
        });
    }
    const conversationId = captureConversationId(payload.conversationId);
    switch (request.operation) {
      case CONVERSATION_API_OPERATION.snapshotGet:
        return this.queries.getSnapshot(conversationId);
      case CONVERSATION_API_OPERATION.runtimePresenceGet:
        return this.runtimePresence.getRuntimePresence(conversationId);
      case CONVERSATION_API_OPERATION.composeStateGet: {
        // 无 compose 会话时返回 null（JSON 可表示"缺省"），客户端映射回 undefined。
        const composeState =
          this.composeStateReader === undefined
            ? undefined
            : await this.composeStateReader.getConversationComposeState(
                conversationId,
              );
        return composeState ?? null;
      }
      case CONVERSATION_API_OPERATION.inputEnqueue: {
        const snapshot = coreEventSchemaRegistry.validateInput(payload.inputEvent, {
          allowUnknownEventType: true,
        });
        if (snapshot.conversationId !== conversationId) {
          throw new InputRejectedError(
            "conversation_id_mismatch",
            "InputEvent targets another Conversation",
          );
        }
        return this.commands.enqueue(
          conversationId,
          new SnapshotBackedInputEvent(snapshot),
        );
      }
      case CONVERSATION_API_OPERATION.eventsList:
        return this.queries.listEvents(
          conversationId,
          cloneJsonRecord(payload.options, "Conversation Event list options") as never,
        );
      default:
        throw new ConversationApiRouterProtocolError(
          "API operation is not supported by Conversation Router",
        );
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new ApiTransportError(
        "HOST_UNAVAILABLE",
        true,
        "Conversation API Router is unavailable",
      );
    }
  }

  private async closeOnce(): Promise<void> {
    this.closed = true;
    const subscriptions = [...this.subscriptions];
    const results = await Promise.allSettled(
      subscriptions.map((subscription) => subscription.close()),
    );
    this.subscriptions.clear();
    const failureCount = results.filter(
      (result) => result.status === "rejected",
    ).length;
    this.logger.info("conversation_api.router_closed", {
      subscriptionCount: subscriptions.length,
      failureCount,
    });
    if (failureCount > 0) {
      throw new ApiTransportError(
        "CONVERSATION_API_ROUTER_CLOSE_FAILED",
        true,
        "Conversation API Router failed to close cleanly",
      );
    }
  }
}

class RoutedConversationApiSubscription implements ApiSubscription {
  readonly id: string;
  private closePromise?: Promise<void>;

  constructor(
    private readonly source: ConversationEventSubscription,
    private readonly logger: Logger,
    private readonly onClosed: () => void,
  ) {
    this.id = source.id;
  }

  [Symbol.asyncIterator](): ApiSubscription {
    return this;
  }

  async next(): Promise<IteratorResult<ApiEventFrame>> {
    try {
      const result = await this.source.next();
      if (result.done) {
        this.onClosed();
        return { done: true, value: undefined };
      }
      return {
        done: false,
        value: Object.freeze({
          protocolVersion: API_PROTOCOL_VERSION,
          subscriptionId: this.id,
          event: result.value,
        }),
      };
    } catch (error) {
      this.onClosed();
      throw createSubscriptionError(error);
    }
  }

  close(): Promise<void> {
    this.closePromise ??= Promise.resolve().then(async () => {
      try {
        await this.source.close();
      } catch (error) {
        throw createSubscriptionError(error);
      } finally {
        this.onClosed();
        this.logger.debug("conversation_api.subscription_closed", {
          subscriptionId: this.id,
        });
      }
    });
    return this.closePromise;
  }
}

class SnapshotBackedInputEvent extends InputEvent {
  private readonly snapshot: InputEventSnapshot;
  private readonly eventPayload: SnapshotEventPayload;

  constructor(snapshot: InputEventSnapshot) {
    super({
      id: snapshot.id,
      conversationId: snapshot.conversationId,
      timestamp: snapshot.timestamp,
      ...(snapshot.correlationId !== undefined
        ? { correlationId: snapshot.correlationId }
        : {}),
      ...(snapshot.causationId !== undefined
        ? { causationId: snapshot.causationId }
        : {}),
      ...(snapshot.runId !== undefined ? { runId: snapshot.runId } : {}),
      ...(snapshot.turnId !== undefined ? { turnId: snapshot.turnId } : {}),
    });
    this.snapshot = cloneInputSnapshot(snapshot);
    this.eventPayload = new SnapshotEventPayload(this.snapshot.payload);
  }

  getEventType(): string {
    return this.snapshot.eventType;
  }

  getPriority(): number {
    return this.snapshot.priority;
  }

  getPayload(): EventPayload {
    return this.eventPayload;
  }

  override getSnapshot(defaultConversationId?: string): InputEventSnapshot {
    if (
      defaultConversationId !== undefined &&
      defaultConversationId !== this.snapshot.conversationId
    ) {
      throw new InputRejectedError(
        "conversation_id_mismatch",
        "InputEvent targets another Conversation",
      );
    }
    return cloneInputSnapshot(this.snapshot);
  }
}

class SnapshotEventPayload extends EventPayload {
  constructor(private readonly value: JsonObject) {
    super();
  }

  toObject(): JsonObject {
    return cloneJson(this.value) as JsonObject;
  }
}

class ConversationApiRouterProtocolError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "ConversationApiRouterProtocolError";
  }
}

function validateRequestEnvelope(request: ApiRequest): string {
  const record = captureRecord(request, "API request");
  assertExactKeys(record, ["protocolVersion", "requestId", "operation", "payload"]);
  if (record.protocolVersion !== API_PROTOCOL_VERSION) {
    throw new ConversationApiRouterProtocolError(
      "API request protocol version is incompatible",
    );
  }
  captureRequestId(request);
  return captureNonEmptyString(record.operation, "API operation");
}

function captureRequestId(request: ApiRequest): string {
  try {
    return captureNonEmptyString(
      captureRecord(request, "API request").requestId,
      "API request id",
    );
  } catch {
    throw new ApiTransportError(
      "INVALID_API_REQUEST",
      false,
      "API request identity is invalid",
    );
  }
}

function expectedPayloadKeys(operation: string): readonly string[] {
  switch (operation) {
    case CONVERSATION_API_OPERATION.create:
    case CONVERSATION_API_OPERATION.list:
      return ["options"];
    case CONVERSATION_API_OPERATION.rename:
      return ["conversationId", "title"];
    case CONVERSATION_API_OPERATION.pin:
      return ["conversationId", "pinned"];
    case CONVERSATION_API_OPERATION.delete:
      return ["conversationId"];
    case CONVERSATION_API_OPERATION.inputEnqueue:
      return ["conversationId", "inputEvent"];
    case CONVERSATION_API_OPERATION.approvalsList:
      return [];
    case CONVERSATION_API_OPERATION.eventsList:
      return ["conversationId", "options"];
    case CONVERSATION_API_OPERATION.snapshotGet:
    case CONVERSATION_API_OPERATION.runtimePresenceGet:
      return ["conversationId"];
    default:
      return ["conversationId"];
  }
}

function capturePayload(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const payload = captureRecord(value, "API request payload");
  assertExactKeys(payload, keys);
  return payload;
}

function captureConversationId(value: unknown): string {
  return captureNonEmptyString(value, "Conversation id");
}

function captureNonBlank(value: unknown, label: string): string {
  return captureNonEmptyString(value, label);
}

function captureBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new ConversationApiRouterProtocolError("pinned must be a boolean");
  }
  return value;
}

function captureCreateConversationOptions(value: unknown): {
  conversationId?: string;
  parentConversationId?: string;
  title?: string;
  pinned?: boolean;
  agent: {
    agentType: string;
    definitionVersion: string;
    manifestId?: string;
    manifestDigest?: string;
  };
} {
  const options = captureJsonRecord(value, "Conversation create options");
  assertAllowedKeys(options, [
    "conversationId",
    "parentConversationId",
    "title",
    "pinned",
    "agent",
  ]);
  if (!("agent" in options)) {
    throw new ConversationApiRouterProtocolError(
      "Conversation create options require an Agent binding",
    );
  }
  const agent = captureJsonRecord(options.agent, "Conversation Agent binding");
  assertAllowedKeys(agent, ["agentType", "definitionVersion", "manifestId", "manifestDigest"]);
  if (!("agentType" in agent) || !("definitionVersion" in agent)) {
    throw new ConversationApiRouterProtocolError(
      "Conversation Agent binding is incomplete",
    );
  }
  return {
    ...(options.conversationId !== undefined
      ? {
          conversationId: captureNonEmptyString(
            options.conversationId,
            "Conversation id",
          ),
        }
      : {}),
    ...(options.parentConversationId !== undefined
      ? {
          parentConversationId: captureNonEmptyString(
            options.parentConversationId,
            "Parent Conversation id",
          ),
        }
      : {}),
    ...(options.title !== undefined
      ? { title: captureNonEmptyString(options.title, "Conversation title") }
      : {}),
    ...(options.pinned !== undefined
      ? { pinned: captureBoolean(options.pinned) }
      : {}),
    agent: {
      agentType: captureNonEmptyString(agent.agentType, "Agent type"),
      definitionVersion: captureNonEmptyString(
        agent.definitionVersion,
        "Agent definition version",
      ),
      ...(agent.manifestId !== undefined
        ? {
            manifestId: captureNonEmptyString(
              agent.manifestId,
              "Agent manifest ID",
            ),
          }
        : {}),
      ...(agent.manifestDigest !== undefined
        ? {
            manifestDigest: captureNonEmptyString(
              agent.manifestDigest,
              "Agent manifest digest",
            ),
          }
        : {}),
    },
  };
}

function captureListConversationsOptions(value: unknown): {
  rootConversationId?: string;
  parentConversationId?: string;
  status?: "active" | "archived" | "disposed";
  limit?: number;
} {
  const options = captureJsonRecord(value, "Conversation list options");
  assertAllowedKeys(options, [
    "rootConversationId",
    "parentConversationId",
    "status",
    "limit",
  ]);
  return {
    ...(options.rootConversationId !== undefined
      ? {
          rootConversationId: captureNonEmptyString(
            options.rootConversationId,
            "Root Conversation id",
          ),
        }
      : {}),
    ...(options.parentConversationId !== undefined
      ? {
          parentConversationId: captureNonEmptyString(
            options.parentConversationId,
            "Parent Conversation id",
          ),
        }
      : {}),
    ...(options.status !== undefined
      ? { status: captureConversationStatus(options.status) }
      : {}),
    ...(options.limit !== undefined
      ? { limit: captureConversationLimit(options.limit) }
      : {}),
  };
}

function captureJsonRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  const record = captureRecord(value, label);
  if (!isJsonValue(record)) {
    throw new ConversationApiRouterProtocolError(`${label} must be JSON-safe`);
  }
  return cloneJson(record) as Record<string, unknown>;
}

function captureConversationStatus(
  value: unknown,
): "active" | "archived" | "disposed" {
  if (value !== "active" && value !== "archived" && value !== "disposed") {
    throw new ConversationApiRouterProtocolError(
      "Conversation status is invalid",
    );
  }
  return value;
}

function captureConversationLimit(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 1_000
  ) {
    throw new ConversationApiRouterProtocolError(
      "Conversation list limit must be an integer from 1 through 1000",
    );
  }
  return value as number;
}

function cloneJsonRecord(value: unknown, label: string): Record<string, unknown> {
  const record = captureRecord(value, label);
  if (!isJsonValue(record)) {
    throw new ConversationApiRouterProtocolError(`${label} must be JSON-safe`);
  }
  return cloneJson(record) as Record<string, unknown>;
}

function cloneInputSnapshot(snapshot: InputEventSnapshot): InputEventSnapshot {
  return cloneJson(snapshot) as unknown as InputEventSnapshot;
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function captureRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConversationApiRouterProtocolError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function captureNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConversationApiRouterProtocolError(
      `${label} must be a non-empty string`,
    );
  }
  return value;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const accepted = [...expected].sort();
  if (
    actual.length !== accepted.length ||
    actual.some((key, index) => key !== accepted[index])
  ) {
    throw new ConversationApiRouterProtocolError(
      "API request contains unexpected fields",
    );
  }
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ConversationApiRouterProtocolError(
      "API request contains unexpected fields",
    );
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw new ApiTransportError(
    "API_REQUEST_ABORTED",
    true,
    "API request was aborted",
  );
}

function createApiErrorSnapshot(error: unknown): ApiErrorSnapshot {
  if (error instanceof ConversationAlreadyExistsError) {
    return freezeError(
      "CONVERSATION_ALREADY_EXISTS",
      "conflict",
      false,
      "Conversation already exists",
    );
  }
  if (error instanceof ConversationParentNotFoundError) {
    return freezeError(
      "CONVERSATION_PARENT_NOT_FOUND",
      "not-found",
      false,
      "Parent Conversation was not found",
    );
  }
  if (error instanceof ConversationNotFoundError) {
    return freezeError(
      "CONVERSATION_NOT_FOUND",
      "not-found",
      false,
      "Conversation was not found",
    );
  }
  if (error instanceof InputRejectedError) {
    if (error.code === "conversation_not_found") {
      return freezeError(
        "CONVERSATION_NOT_FOUND",
        "not-found",
        false,
        "Conversation was not found",
      );
    }
    if (error.code === "conversation_not_accepting_input") {
      return freezeError(
        "CONVERSATION_NOT_ACCEPTING_INPUT",
        "conflict",
        false,
        "Conversation is not accepting input",
      );
    }
    if (error.code === "event_id_conflict") {
      return freezeError(
        "EVENT_ID_CONFLICT",
        "conflict",
        false,
        "Event identity conflicts with durable history",
      );
    }
    return freezeError(
      "INVALID_API_REQUEST",
      "validation",
      false,
      "API request is invalid",
    );
  }
  if (
    error instanceof ConversationApiRouterProtocolError ||
    error instanceof TypeError ||
    error instanceof EventValidationError ||
    error instanceof ConversationEventQueryError ||
    error instanceof ConversationEventFilterError ||
    error instanceof ConversationEventSubscriptionOptionsError ||
    error instanceof ConversationEventSubscriptionCursorAheadError
  ) {
    return freezeError(
      "INVALID_API_REQUEST",
      "validation",
      false,
      "API request is invalid",
    );
  }
  if (
    error instanceof ConversationAgentBindingMissingError ||
    error instanceof ConversationWorkspaceMismatchError
  ) {
    return freezeError(
      "CONVERSATION_CATALOG_INTEGRITY_ERROR",
      "internal",
      false,
      "Conversation Catalog is inconsistent",
    );
  }
  if (error instanceof ConversationEventHubClosedError) {
    return freezeError(
      "HOST_UNAVAILABLE",
      "unavailable",
      true,
      "Conversation Host is unavailable",
    );
  }
  return freezeError(
    "INTERNAL_ERROR",
    "internal",
    false,
    "An internal Conversation Host error occurred",
  );
}

function createSubscriptionError(error: unknown): ApiTransportError {
  if (error instanceof ApiTransportError) return error;
  if (error instanceof ConversationNotFoundError) {
    return new ApiTransportError(
      "CONVERSATION_NOT_FOUND",
      false,
      "Conversation was not found",
    );
  }
  if (
    error instanceof ConversationApiRouterProtocolError ||
    error instanceof ConversationEventFilterError ||
    error instanceof ConversationEventSubscriptionOptionsError ||
    error instanceof ConversationEventSubscriptionCursorAheadError
  ) {
    return new ApiTransportError(
      "INVALID_API_REQUEST",
      false,
      "Conversation subscription request is invalid",
    );
  }
  if (error instanceof ConversationEventSubscriptionOverflowError) {
    return new ApiTransportError(
      "CONVERSATION_EVENT_SUBSCRIPTION_OVERFLOW",
      true,
      "Conversation Event subscription overflowed",
    );
  }
  if (error instanceof ConversationEventSubscriptionAbortedError) {
    return new ApiTransportError(
      "API_REQUEST_ABORTED",
      true,
      "Conversation Event subscription was aborted",
    );
  }
  if (error instanceof ConversationEventHubClosedError) {
    return new ApiTransportError(
      "HOST_UNAVAILABLE",
      true,
      "Conversation Host is unavailable",
    );
  }
  return new ApiTransportError(
    "INTERNAL_ERROR",
    false,
    "Conversation Event subscription failed",
  );
}

function freezeError(
  code: string,
  category: ApiErrorSnapshot["category"],
  retryable: boolean,
  message: string,
): ApiErrorSnapshot {
  return Object.freeze({ code, category, retryable, message });
}
