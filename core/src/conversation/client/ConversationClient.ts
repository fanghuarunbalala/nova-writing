/** Maps typed Conversation operations to validated, serializable API frames. */
import {
  coreEventSchemaRegistry,
  isJsonValue,
  type InputEvent,
  type InputReceipt,
} from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type {
  ConversationEventPage,
  ConversationEventSubscription,
} from "../../storage/index.js";
import { validatePersistedConversationEventSnapshot } from "../../storage/index.js";
import {
  API_PROTOCOL_VERSION,
  ApiRemoteError,
  isApiErrorCategory,
  type ApiErrorSnapshot,
  type ApiRequest,
  type ApiResponse,
  type ApiTransport,
} from "../../transport/index.js";
import type {
  BoundConversationEventSubscriptionOptions,
  ConversationEventListOptions,
} from "../ConversationEvents.js";
import type { ConversationSnapshot } from "../ConversationSnapshot.js";
import type {
  ConversationCatalogResult,
  CreateConversationOptions,
  ListConversationsOptions,
} from "../catalog/index.js";
import {
  isRuntimePresenceState,
  type RuntimePresence,
} from "../RuntimePresence.js";
import { ApiConversationEventSubscription } from "./ApiConversationEventSubscription.js";
import {
  CONVERSATION_API_OPERATION,
  type CreateConversationRequest,
  type EnqueueConversationInputRequest,
  type ListConversationsRequest,
  type ListConversationEventsRequest,
  type SerializableConversationEventSubscriptionOptions,
  type SubscribeConversationEventsRequest,
} from "./ConversationApiOperations.js";
import { ConversationClientProtocolError } from "./ConversationClientErrors.js";

export type ApiRequestIdFactory = () => string;

export interface ConversationClientOptions {
  readonly transport: ApiTransport;
  readonly requestIdFactory?: ApiRequestIdFactory;
  readonly logger?: Logger;
}

export class ConversationClient {
  private readonly transport: ApiTransport;
  private readonly requestIdFactory: ApiRequestIdFactory;
  private readonly logger: Logger;

  constructor(options: ConversationClientOptions) {
    this.transport = options.transport;
    this.requestIdFactory = options.requestIdFactory ?? generateApiRequestId;
    this.logger = (options.logger ?? noopLogger).child({
      component: "conversation_client",
    });
  }

  async create(options: CreateConversationOptions): Promise<ConversationSnapshot> {
    const payload: CreateConversationRequest = {
      options: cloneCreateConversationOptions(options),
    };
    const snapshot = await this.request(
      CONVERSATION_API_OPERATION.create,
      payload,
    );
    return validateConversationSnapshot(snapshot);
  }

  async list(
    options: ListConversationsOptions = {},
  ): Promise<ConversationCatalogResult> {
    const payload: ListConversationsRequest = {
      options: cloneListConversationsOptions(options),
    };
    const result = await this.request(
      CONVERSATION_API_OPERATION.list,
      payload,
    );
    return validateConversationCatalogResult(result);
  }

  async enqueueInput(
    conversationId: string,
    event: InputEvent,
  ): Promise<InputReceipt> {
    const validatedConversationId = validateConversationId(conversationId);
    const inputEvent = event.getSnapshot(validatedConversationId);
    coreEventSchemaRegistry.validateInput(inputEvent, {
      allowUnknownEventType: true,
    });
    const receipt = await this.request<EnqueueConversationInputRequest, unknown>(
      CONVERSATION_API_OPERATION.inputEnqueue,
      {
        conversationId: validatedConversationId,
        inputEvent,
      },
      validatedConversationId,
    );
    return validateInputReceipt(receipt, validatedConversationId, inputEvent.id);
  }

  async getSnapshot(conversationId: string): Promise<ConversationSnapshot> {
    const validatedConversationId = validateConversationId(conversationId);
    const snapshot = await this.request(
      CONVERSATION_API_OPERATION.snapshotGet,
      { conversationId: validatedConversationId },
      validatedConversationId,
    );
    return validateConversationSnapshot(snapshot, validatedConversationId);
  }

  async getRuntimePresence(conversationId: string): Promise<RuntimePresence> {
    const validatedConversationId = validateConversationId(conversationId);
    const presence = await this.request(
      CONVERSATION_API_OPERATION.runtimePresenceGet,
      { conversationId: validatedConversationId },
      validatedConversationId,
    );
    return validateRuntimePresence(presence);
  }

  async listEvents(
    conversationId: string,
    options: ConversationEventListOptions,
  ): Promise<ConversationEventPage> {
    const validatedConversationId = validateConversationId(conversationId);
    const payload: ListConversationEventsRequest = {
      conversationId: validatedConversationId,
      options: cloneEventListOptions(options),
    };
    const page = await this.request(
      CONVERSATION_API_OPERATION.eventsList,
      payload,
      validatedConversationId,
    );
    return validateConversationEventPage(page, validatedConversationId);
  }

  subscribeEvents(
    conversationId: string,
    options: BoundConversationEventSubscriptionOptions,
  ): ConversationEventSubscription {
    const validatedConversationId = validateConversationId(conversationId);
    const { signal, ...serializableOptions } = options;
    const payload: SubscribeConversationEventsRequest = {
      conversationId: validatedConversationId,
      options: cloneSubscriptionOptions(serializableOptions),
    };
    const request = this.createRequest(
      CONVERSATION_API_OPERATION.eventsSubscribe,
      payload,
    );
    this.assertRequestSerializable(request);
    const subscription = this.transport.subscribe(request, {
      ...(signal !== undefined ? { signal } : {}),
    });
    this.logger.info("conversation.client.subscription_opened", {
      operation: request.operation,
      requestId: request.requestId,
      conversationId: validatedConversationId,
      subscriptionId: subscription.id,
    });
    return new ApiConversationEventSubscription({
      conversationId: validatedConversationId,
      subscription,
      logger: this.logger,
    });
  }

  private async request<TPayload, TData>(
    operation: string,
    payload: TPayload,
    conversationId?: string,
  ): Promise<TData> {
    const request = this.createRequest(operation, payload);
    this.assertRequestSerializable(request);
    this.logger.debug("conversation.client.request_started", {
      operation,
      requestId: request.requestId,
      ...(conversationId !== undefined ? { conversationId } : {}),
    });
    const response = await this.transport.request<TData>(request);
    const data = validateApiResponse(response, request.requestId);
    this.logger.debug("conversation.client.request_completed", {
      operation,
      requestId: request.requestId,
      ...(conversationId !== undefined ? { conversationId } : {}),
    });
    return data;
  }

  private createRequest<TPayload>(
    operation: string,
    payload: TPayload,
  ): ApiRequest<string, TPayload> {
    return Object.freeze({
      protocolVersion: API_PROTOCOL_VERSION,
      requestId: validateRequestId(this.requestIdFactory()),
      operation,
      payload,
    });
  }

  private assertRequestSerializable(request: ApiRequest): void {
    if (!isJsonValue(request)) {
      throw new ConversationClientProtocolError(
        "API request must contain only JSON-compatible values",
      );
    }
  }
}

function validateApiResponse<TData>(
  value: ApiResponse<TData>,
  expectedRequestId: string,
): TData {
  const response = assertRecord(value, "API response");
  if (response.protocolVersion !== API_PROTOCOL_VERSION) {
    throw new ConversationClientProtocolError(
      "API response protocol version is incompatible",
    );
  }
  if (response.requestId !== expectedRequestId) {
    throw new ConversationClientProtocolError(
      "API response requestId does not match the request",
    );
  }
  if (response.ok === false) {
    throw new ApiRemoteError(validateApiErrorSnapshot(response.error));
  }
  if (response.ok !== true || !("data" in response)) {
    throw new ConversationClientProtocolError("API response shape is invalid");
  }
  if (!isJsonValue(response.data)) {
    throw new ConversationClientProtocolError(
      "API response data must contain only JSON-compatible values",
    );
  }
  return response.data as TData;
}

function validateApiErrorSnapshot(value: unknown): ApiErrorSnapshot {
  const error = assertRecord(value, "API error snapshot");
  return Object.freeze({
    code: assertNonEmptyString(error.code, "API error code"),
    category: isApiErrorCategory(error.category)
      ? error.category
      : invalid("API error category is invalid"),
    retryable: assertBoolean(error.retryable, "API error retryable"),
    message: assertNonEmptyString(error.message, "API error message"),
  });
}

function validateInputReceipt(
  value: unknown,
  expectedConversationId: string,
  expectedInputEventId: string,
): InputReceipt {
  const receipt = assertRecord(value, "Input receipt");
  const status = receipt.status;
  if (status !== "accepted" && status !== "duplicate") {
    throw new ConversationClientProtocolError("Input receipt status is invalid");
  }
  if (receipt.conversationId !== expectedConversationId) {
    throw new ConversationClientProtocolError(
      "Input receipt targets another Conversation",
    );
  }
  if (receipt.inputEventId !== expectedInputEventId) {
    throw new ConversationClientProtocolError(
      "Input receipt targets another InputEvent",
    );
  }
  return Object.freeze({
    status,
    conversationId: expectedConversationId,
    inputEventId: expectedInputEventId,
    sequence: assertSafeInteger(receipt.sequence, "Input receipt sequence", 1),
    acceptedAt: assertNonEmptyString(receipt.acceptedAt, "Input receipt acceptedAt"),
  });
}

function validateConversationSnapshot(
  value: unknown,
  expectedConversationId?: string,
): ConversationSnapshot {
  const snapshot = assertRecord(value, "Conversation snapshot");
  const metadata = assertRecord(snapshot.metadata, "Conversation metadata");
  const binding = assertRecord(
    snapshot.activeAgentBinding,
    "Conversation active Agent binding",
  );
  const conversationId = assertNonEmptyString(
    metadata.id,
    "Conversation id",
  );
  if (
    (expectedConversationId !== undefined && conversationId !== expectedConversationId) ||
    binding.conversationId !== conversationId
  ) {
    throw new ConversationClientProtocolError(
      "Conversation snapshot identity does not match the requested Conversation",
    );
  }
  const status = metadata.status;
  if (status !== "active" && status !== "archived" && status !== "disposed") {
    throw new ConversationClientProtocolError("Conversation status is invalid");
  }
  const bindingStatus = binding.status;
  if (
    bindingStatus !== "active" &&
    bindingStatus !== "superseded" &&
    bindingStatus !== "detached"
  ) {
    throw new ConversationClientProtocolError("Agent binding status is invalid");
  }
  return Object.freeze({
    metadata: Object.freeze({
      id: conversationId,
      workspaceId: assertNonEmptyString(metadata.workspaceId, "Workspace id"),
      ...(metadata.parentConversationId !== undefined
        ? {
            parentConversationId: assertNonEmptyString(
              metadata.parentConversationId,
              "Parent Conversation id",
            ),
          }
        : {}),
      rootConversationId: assertNonEmptyString(
        metadata.rootConversationId,
        "Root Conversation id",
      ),
      status,
      createdAt: assertNonEmptyString(metadata.createdAt, "Conversation createdAt"),
      updatedAt: assertNonEmptyString(metadata.updatedAt, "Conversation updatedAt"),
      lastJournalSequence: assertSafeInteger(
        metadata.lastJournalSequence,
        "Conversation last Journal sequence",
        0,
      ),
    }),
    activeAgentBinding: Object.freeze({
      id: assertNonEmptyString(binding.id, "Agent binding id"),
      conversationId,
      revision: assertSafeInteger(binding.revision, "Agent binding revision", 1),
      agentType: assertNonEmptyString(binding.agentType, "Agent type"),
      definitionVersion: assertNonEmptyString(
        binding.definitionVersion,
        "Agent definition version",
      ),
      ...(binding.manifestId !== undefined
        ? {
            manifestId: assertNonEmptyString(
              binding.manifestId,
              "Agent manifest ID",
            ),
          }
        : {}),
      ...(binding.manifestDigest !== undefined
        ? {
            manifestDigest: assertNonEmptyString(
              binding.manifestDigest,
              "Agent manifest digest",
            ),
          }
        : {}),
      status: bindingStatus,
      createdAt: assertNonEmptyString(binding.createdAt, "Agent binding createdAt"),
      ...(binding.supersededAt !== undefined
        ? {
            supersededAt: assertNonEmptyString(
              binding.supersededAt,
              "Agent binding supersededAt",
            ),
          }
        : {}),
    }),
  });
}

function validateConversationCatalogResult(
  value: unknown,
): ConversationCatalogResult {
  const result = assertRecord(value, "Conversation catalog result");
  if (!Array.isArray(result.conversations)) {
    throw new ConversationClientProtocolError(
      "Conversation catalog result conversations must be an array",
    );
  }
  return Object.freeze({
    conversations: Object.freeze(
      result.conversations.map((snapshot) =>
        validateConversationSnapshot(snapshot),
      ),
    ),
  });
}

function validateRuntimePresence(value: unknown): RuntimePresence {
  const presence = assertRecord(value, "Runtime presence");
  if (!isRuntimePresenceState(presence.state)) {
    throw new ConversationClientProtocolError("Runtime presence state is invalid");
  }
  return Object.freeze({
    state: presence.state,
    observedAt: assertNonEmptyString(
      presence.observedAt,
      "Runtime presence observedAt",
    ),
  });
}

function validateConversationEventPage(
  value: unknown,
  expectedConversationId: string,
): ConversationEventPage {
  const page = assertRecord(value, "Conversation Event page");
  if (!Array.isArray(page.events)) {
    throw new ConversationClientProtocolError(
      "Conversation Event page events must be an array",
    );
  }
  return Object.freeze({
    events: Object.freeze(
      page.events.map((event) =>
        validatePersistedConversationEventSnapshot(event, expectedConversationId),
      ),
    ) as unknown as ConversationEventPage["events"],
    highWatermark: assertSafeInteger(
      page.highWatermark,
      "Conversation Event page highWatermark",
      0,
    ),
    hasPrevious: assertBoolean(
      page.hasPrevious,
      "Conversation Event page hasPrevious",
    ),
    hasNext: assertBoolean(page.hasNext, "Conversation Event page hasNext"),
  });
}

function cloneEventListOptions(
  options: ConversationEventListOptions,
): ConversationEventListOptions {
  return {
    ...options,
    anchor: { ...options.anchor },
    ...(options.eventTypes !== undefined
      ? { eventTypes: [...options.eventTypes] }
      : {}),
  };
}

function cloneSubscriptionOptions(
  options: SerializableConversationEventSubscriptionOptions,
): SerializableConversationEventSubscriptionOptions {
  return {
    ...options,
    start: { ...options.start },
    ...(options.filter !== undefined
      ? {
          filter: {
            ...options.filter,
            ...(options.filter.eventTypes !== undefined
              ? { eventTypes: [...options.filter.eventTypes] }
              : {}),
          },
        }
      : {}),
  };
}

function cloneCreateConversationOptions(
  options: CreateConversationOptions,
): CreateConversationOptions {
  return {
    ...(options.conversationId !== undefined
      ? { conversationId: options.conversationId }
      : {}),
    ...(options.parentConversationId !== undefined
      ? { parentConversationId: options.parentConversationId }
      : {}),
    agent: { ...options.agent },
  };
}

function cloneListConversationsOptions(
  options: ListConversationsOptions,
): ListConversationsOptions {
  return { ...options };
}

function generateApiRequestId(): string {
  return `api_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}

function validateConversationId(value: string): string {
  return assertNonEmptyString(value, "Conversation id");
}

function validateRequestId(value: string): string {
  return assertNonEmptyString(value, "API request id");
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

function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new ConversationClientProtocolError(`${label} must be a boolean`);
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

function invalid(message: string): never {
  throw new ConversationClientProtocolError(message);
}
