/**
 * Builds immutable Runtime bootstraps from durable Conversation and Journal
 * read models without exposing Store paths or Event payloads.
 *
 * @example
 * ```ts
 * const factory = new StorageConversationRuntimeBootstrapFactory({
 *   snapshotReader,
 *   journal,
 *   workspace,
 * });
 * const bootstrap = await factory.create(request);
 * ```
 */
import { isEventType } from "../../event/index.js";
import type { AgentManifestStore } from "../../agent/manifest/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type {
  ConversationJournalReader,
  PersistedConversationEventSnapshot,
  WorkspaceStoreLocation,
} from "../../storage/index.js";
import type { ConversationSnapshot } from "../ConversationSnapshot.js";
import type { ConversationSnapshotReader } from "../ConversationSnapshotReader.js";
import {
  CONVERSATION_RUNTIME_ACTIVATION_REASON,
  type ConversationRuntimeActivationCause,
} from "./ConversationRuntimeActivation.js";
import {
  CONVERSATION_RUNTIME_BOOTSTRAP_SCHEMA_VERSION,
  type ConversationRuntimeBootstrap,
} from "./ConversationRuntimeBootstrap.js";
import type {
  ConversationRuntimeBootstrapFactory,
  ConversationRuntimeBootstrapRequest,
} from "./ConversationRuntimeBootstrapFactory.js";
import {
  ConversationRuntimeBootstrapConversationNotActiveError,
  ConversationRuntimeBootstrapHighWatermarkError,
  ConversationRuntimeBootstrapInputMismatchError,
  ConversationRuntimeBootstrapInputNotFoundError,
  ConversationRuntimeBootstrapValidationError,
  ConversationRuntimeBootstrapWorkspaceMismatchError,
} from "./ConversationRuntimeBootstrapErrors.js";
import type { ConversationRuntimeInputReference } from "./ConversationRuntimeInputReference.js";

export interface StorageConversationRuntimeBootstrapFactoryOptions {
  snapshotReader: ConversationSnapshotReader;
  journal: ConversationJournalReader;
  workspace: WorkspaceStoreLocation;
  agentManifestStore?: AgentManifestStore;
  logger?: Logger;
}

interface RequestLogIdentity {
  conversationId: string;
  runtimeInstanceId: string;
  activationReason: string;
  activationSequence?: number;
}

export class StorageConversationRuntimeBootstrapFactory
  implements ConversationRuntimeBootstrapFactory
{
  private readonly snapshotReader: ConversationSnapshotReader;
  private readonly journal: ConversationJournalReader;
  private readonly workspaceId: string;
  private readonly workdir: string;
  private readonly agentManifestStore?: AgentManifestStore;
  private readonly logger: Logger;

  constructor(options: StorageConversationRuntimeBootstrapFactoryOptions) {
    this.snapshotReader = options.snapshotReader;
    this.journal = options.journal;
    this.workspaceId = options.workspace.workspaceId;
    this.workdir = options.workspace.workspaceRoot;
    this.agentManifestStore = options.agentManifestStore;
    this.logger = (options.logger ?? noopLogger).child({
      component: "storage_conversation_runtime_bootstrap_factory",
    });
  }

  async create(
    request: ConversationRuntimeBootstrapRequest,
  ): Promise<ConversationRuntimeBootstrap> {
    const logIdentity = getRequestLogIdentity(request);
    try {
      const captured = captureBootstrapRequest(request);
      this.logger.debug("conversation.runtime_bootstrap.create_started", {
        ...logIdentity,
      });

      const snapshot = await this.snapshotReader.getSnapshot(captured.conversationId);
      this.validateSnapshot(captured.conversationId, snapshot);
      await this.validateAgentManifest(snapshot);
      if (captured.activation.reason === CONVERSATION_RUNTIME_ACTIVATION_REASON.acceptedInput) {
        await this.validateDurableInput(captured.activation.input);
      }

      const highWatermark = await this.journal.getHighWatermark(captured.conversationId);
      this.validateHighWatermark(captured, snapshot, highWatermark);
      const bootstrap = createFrozenBootstrap(captured, snapshot, {
        workspaceId: this.workspaceId,
        workdir: this.workdir,
        highWatermark,
      });

      this.logger.info("conversation.runtime_bootstrap.created", {
        ...logIdentity,
        highWatermark,
        agentType: bootstrap.conversation.activeAgentBinding.agentType,
        definitionVersion: bootstrap.conversation.activeAgentBinding.definitionVersion,
      });
      return bootstrap;
    } catch (error) {
      this.logger.warn("conversation.runtime_bootstrap.rejected", {
        ...logIdentity,
        ...getErrorIdentity(error),
      });
      throw error;
    }
  }

  private validateSnapshot(
    conversationId: string,
    snapshot: ConversationSnapshot,
  ): void {
    if (
      snapshot === null ||
      typeof snapshot !== "object" ||
      snapshot.metadata === null ||
      typeof snapshot.metadata !== "object" ||
      snapshot.activeAgentBinding === null ||
      typeof snapshot.activeAgentBinding !== "object"
    ) {
      throw new ConversationRuntimeBootstrapValidationError(
        "snapshot_conversation_mismatch",
      );
    }
    if (snapshot.metadata.id !== conversationId) {
      throw new ConversationRuntimeBootstrapValidationError(
        "snapshot_conversation_mismatch",
      );
    }
    if (snapshot.activeAgentBinding.conversationId !== conversationId) {
      throw new ConversationRuntimeBootstrapValidationError(
        "snapshot_agent_binding_mismatch",
      );
    }
    if (snapshot.activeAgentBinding.status !== "active") {
      throw new ConversationRuntimeBootstrapValidationError(
        "snapshot_agent_binding_mismatch",
      );
    }
    if (
      snapshot.metadata.status !== "active" &&
      snapshot.metadata.status !== "archived" &&
      snapshot.metadata.status !== "disposed"
    ) {
      throw new ConversationRuntimeBootstrapValidationError(
        "snapshot_conversation_mismatch",
      );
    }
    if (snapshot.metadata.status !== "active") {
      throw new ConversationRuntimeBootstrapConversationNotActiveError(
        conversationId,
        snapshot.metadata.status,
      );
    }
    if (snapshot.metadata.workspaceId !== this.workspaceId) {
      throw new ConversationRuntimeBootstrapWorkspaceMismatchError(
        conversationId,
        this.workspaceId,
        snapshot.metadata.workspaceId,
      );
    }
    if (
      !Number.isSafeInteger(snapshot.metadata.lastJournalSequence) ||
      snapshot.metadata.lastJournalSequence < 0
    ) {
      throw new ConversationRuntimeBootstrapValidationError(
        "snapshot_conversation_mismatch",
      );
    }
  }

  private async validateAgentManifest(
    snapshot: ConversationSnapshot,
  ): Promise<void> {
    const binding = snapshot.activeAgentBinding;
    if (binding.manifestId === undefined) {
      return;
    }
    if (
      binding.manifestId === undefined ||
      binding.manifestDigest === undefined ||
      this.agentManifestStore === undefined
    ) {
      throw new ConversationRuntimeBootstrapValidationError(
        "agent_manifest_missing",
      );
    }
    const manifest = await this.agentManifestStore.get(binding.manifestId);
    if (
      manifest === undefined ||
      manifest.manifestDigest !== binding.manifestDigest ||
      manifest.agentType !== binding.agentType ||
      manifest.definitionVersion !== binding.definitionVersion
    ) {
      throw new ConversationRuntimeBootstrapValidationError(
        "agent_manifest_mismatch",
      );
    }
  }

  private async validateDurableInput(
    input: ConversationRuntimeInputReference,
  ): Promise<void> {
    const event = await this.journal.getBySequence(input.conversationId, input.sequence);
    if (event === undefined) {
      throw new ConversationRuntimeBootstrapInputNotFoundError(
        input.conversationId,
        input.sequence,
      );
    }
    assertInputField(event, input, "direction", event.direction, "input");
    assertInputField(event, input, "conversationId", event.conversationId, input.conversationId);
    assertInputField(event, input, "sequence", event.sequence, input.sequence);
    assertInputField(event, input, "inputEventId", event.id, input.inputEventId);
    assertInputField(event, input, "eventType", event.eventType, input.eventType);
    assertInputField(
      event,
      input,
      "correlationId",
      event.correlationId,
      input.correlationId,
    );
    assertInputField(event, input, "runId", event.runId, input.runId);
    assertInputField(event, input, "turnId", event.turnId, input.turnId);
  }

  private validateHighWatermark(
    request: ConversationRuntimeBootstrapRequest,
    snapshot: ConversationSnapshot,
    highWatermark: number,
  ): void {
    const activationSequence =
      request.activation.reason === CONVERSATION_RUNTIME_ACTIVATION_REASON.acceptedInput
        ? request.activation.input.sequence
        : 0;
    if (
      !Number.isSafeInteger(highWatermark) ||
      highWatermark < 0 ||
      highWatermark < snapshot.metadata.lastJournalSequence ||
      highWatermark < activationSequence
    ) {
      throw new ConversationRuntimeBootstrapHighWatermarkError(
        request.conversationId,
        highWatermark,
      );
    }
  }
}

function captureBootstrapRequest(
  request: ConversationRuntimeBootstrapRequest,
): ConversationRuntimeBootstrapRequest {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new ConversationRuntimeBootstrapValidationError("invalid_request");
  }
  assertNonEmptyString(request.conversationId);
  assertNonEmptyString(request.runtimeInstanceId);
  if (
    typeof request.activatedAt !== "string" ||
    Number.isNaN(Date.parse(request.activatedAt))
  ) {
    throw new ConversationRuntimeBootstrapValidationError("invalid_request");
  }

  return Object.freeze({
    conversationId: request.conversationId,
    runtimeInstanceId: request.runtimeInstanceId,
    activatedAt: request.activatedAt,
    activation: captureActivationCause(request.activation, request.conversationId),
  });
}

function captureActivationCause(
  activation: ConversationRuntimeActivationCause,
  conversationId: string,
): ConversationRuntimeActivationCause {
  if (activation === null || typeof activation !== "object" || Array.isArray(activation)) {
    throw new ConversationRuntimeBootstrapValidationError("invalid_request");
  }
  if (activation.reason === CONVERSATION_RUNTIME_ACTIVATION_REASON.acceptedInput) {
    const input = captureInputReference(activation.input);
    if (input.conversationId !== conversationId) {
      throw new ConversationRuntimeBootstrapInputMismatchError(
        conversationId,
        input.sequence,
        "conversationId",
      );
    }
    return Object.freeze({ reason: activation.reason, input });
  }
  if (
    activation.reason === CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore ||
    activation.reason === CONVERSATION_RUNTIME_ACTIVATION_REASON.crashRecovery
  ) {
    if ("input" in activation) {
      throw new ConversationRuntimeBootstrapValidationError("invalid_request");
    }
    return Object.freeze({ reason: activation.reason });
  }
  throw new ConversationRuntimeBootstrapValidationError("invalid_request");
}

function captureInputReference(
  input: ConversationRuntimeInputReference,
): ConversationRuntimeInputReference {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ConversationRuntimeBootstrapValidationError("invalid_request");
  }
  assertNonEmptyString(input.conversationId);
  assertNonEmptyString(input.inputEventId);
  if (typeof input.eventType !== "string" || !isEventType(input.eventType)) {
    throw new ConversationRuntimeBootstrapValidationError("invalid_request");
  }
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new ConversationRuntimeBootstrapValidationError("invalid_request");
  }
  assertOptionalNonEmptyString(input.correlationId);
  assertOptionalNonEmptyString(input.runId);
  assertOptionalNonEmptyString(input.turnId);

  return Object.freeze({
    conversationId: input.conversationId,
    inputEventId: input.inputEventId,
    eventType: input.eventType,
    sequence: input.sequence,
    ...(input.correlationId !== undefined
      ? { correlationId: input.correlationId }
      : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
  });
}

function createFrozenBootstrap(
  request: ConversationRuntimeBootstrapRequest,
  snapshot: ConversationSnapshot,
  options: {
    workspaceId: string;
    workdir: string;
    highWatermark: number;
  },
): ConversationRuntimeBootstrap {
  const conversation = Object.freeze({
    metadata: Object.freeze({ ...snapshot.metadata }),
    activeAgentBinding: Object.freeze({ ...snapshot.activeAgentBinding }),
  });
  return Object.freeze({
    schemaVersion: CONVERSATION_RUNTIME_BOOTSTRAP_SCHEMA_VERSION,
    runtimeInstanceId: request.runtimeInstanceId,
    activatedAt: request.activatedAt,
    conversation,
    workspace: Object.freeze({
      workspaceId: options.workspaceId,
      workdir: options.workdir,
    }),
    activation: request.activation,
    journal: Object.freeze({ highWatermark: options.highWatermark }),
  });
}

function assertInputField(
  event: PersistedConversationEventSnapshot,
  input: ConversationRuntimeInputReference,
  field: string,
  received: unknown,
  expected: unknown,
): void {
  if (received !== expected) {
    throw new ConversationRuntimeBootstrapInputMismatchError(
      input.conversationId,
      event.sequence,
      field,
    );
  }
}

function assertNonEmptyString(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConversationRuntimeBootstrapValidationError("invalid_request");
  }
}

function assertOptionalNonEmptyString(value: unknown): void {
  if (value !== undefined) assertNonEmptyString(value);
}

function getRequestLogIdentity(request: unknown): RequestLogIdentity {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    return {
      conversationId: "unknown",
      runtimeInstanceId: "unknown",
      activationReason: "unknown",
    };
  }
  const candidate = request as {
    conversationId?: unknown;
    runtimeInstanceId?: unknown;
    activation?: { reason?: unknown; input?: { sequence?: unknown } };
  };
  return {
    conversationId: getSafeLogIdentifier(candidate.conversationId),
    runtimeInstanceId: getSafeLogIdentifier(candidate.runtimeInstanceId),
    activationReason:
      candidate.activation?.reason === CONVERSATION_RUNTIME_ACTIVATION_REASON.acceptedInput ||
      candidate.activation?.reason === CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore ||
      candidate.activation?.reason === CONVERSATION_RUNTIME_ACTIVATION_REASON.crashRecovery
        ? candidate.activation.reason
        : "unknown",
    ...(Number.isSafeInteger(candidate.activation?.input?.sequence)
      ? { activationSequence: candidate.activation?.input?.sequence as number }
      : {}),
  };
}

function getSafeLogIdentifier(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/u.test(value)
    ? value
    : "unknown";
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
