/** Strict JSON-safe RPC payloads for one child-hosted Conversation Runtime. */
import {
  CONVERSATION_RUNTIME_ACTIVATION_REASON,
  CONVERSATION_RUNTIME_BOOTSTRAP_SCHEMA_VERSION,
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
  type ConversationRuntimeBootstrap,
  type ConversationRuntimeHandleShutdownRequest,
  type ConversationRuntimeInputReference,
} from "../../../conversation/host/index.js";
import { isEventType, type JsonValue } from "../../../event/protocol/index.js";

export const RUNTIME_CHILD_RPC_METHOD = {
  bootstrap: "runtime.bootstrap",
  dispatchInput: "runtime.dispatch_input",
  shutdown: "runtime.shutdown",
} as const;

export const RUNTIME_CHILD_ACK_STATUS = "accepted" as const;

export interface RuntimeChildBootstrapAck {
  readonly status: typeof RUNTIME_CHILD_ACK_STATUS;
  readonly conversationId: string;
  readonly runtimeInstanceId: string;
  readonly throughSequence: number;
}

export interface RuntimeChildCommandAck {
  readonly status: typeof RUNTIME_CHILD_ACK_STATUS;
}

export function encodeRuntimeChildBootstrap(
  bootstrap: ConversationRuntimeBootstrap,
): JsonValue {
  return captureRuntimeChildBootstrap(bootstrap) as unknown as JsonValue;
}

export function captureRuntimeChildBootstrap(
  value: unknown,
): ConversationRuntimeBootstrap {
  const record = captureRecord(value, [
    "schemaVersion",
    "runtimeInstanceId",
    "activatedAt",
    "conversation",
    "workspace",
    "activation",
    "journal",
  ]);
  if (record.schemaVersion !== CONVERSATION_RUNTIME_BOOTSTRAP_SCHEMA_VERSION) {
    throw new RuntimeChildPayloadError("bootstrap");
  }
  const runtimeInstanceId = captureNonBlank(record.runtimeInstanceId, "bootstrap");
  const activatedAt = captureTimestamp(record.activatedAt, "bootstrap");
  const conversation = captureConversation(record.conversation);
  const workspace = captureWorkspace(record.workspace);
  const activation = captureActivation(record.activation, conversation.metadata.id);
  const journal = captureJournal(record.journal);
  if (conversation.metadata.workspaceId !== workspace.workspaceId) {
    throw new RuntimeChildPayloadError("bootstrap");
  }
  return Object.freeze({
    schemaVersion: CONVERSATION_RUNTIME_BOOTSTRAP_SCHEMA_VERSION,
    runtimeInstanceId,
    activatedAt,
    conversation,
    workspace,
    activation,
    journal,
  });
}

export function encodeRuntimeChildInput(
  input: ConversationRuntimeInputReference,
): JsonValue {
  return captureRuntimeChildInput(input) as unknown as JsonValue;
}

export function captureRuntimeChildInput(
  value: unknown,
): ConversationRuntimeInputReference {
  const record = captureRecord(value, [
    "conversationId",
    "inputEventId",
    "eventType",
    "sequence",
  ], ["correlationId", "runId", "turnId"], "input");
  const eventType = captureNonBlank(record.eventType, "input");
  if (!isEventType(eventType)) throw new RuntimeChildPayloadError("input");
  return Object.freeze({
    conversationId: captureNonBlank(record.conversationId, "input"),
    inputEventId: captureNonBlank(record.inputEventId, "input"),
    eventType,
    sequence: captureInteger(record.sequence, 1, "input"),
    ...captureOptionalIdentities(record, ["correlationId", "runId", "turnId"], "input"),
  });
}

export function encodeRuntimeChildShutdown(
  request: ConversationRuntimeHandleShutdownRequest,
): JsonValue {
  return captureRuntimeChildShutdown(request) as unknown as JsonValue;
}

export function captureRuntimeChildShutdown(
  value: unknown,
): ConversationRuntimeHandleShutdownRequest {
  const record = captureRecord(value, ["reason"], [], "shutdown");
  const reason = record.reason;
  if (
    typeof reason !== "string" ||
    !Object.values(CONVERSATION_RUNTIME_SHUTDOWN_REASON).includes(
      reason as ConversationRuntimeHandleShutdownRequest["reason"],
    )
  ) {
    throw new RuntimeChildPayloadError("shutdown");
  }
  return Object.freeze({
    reason: reason as ConversationRuntimeHandleShutdownRequest["reason"],
  });
}

export function captureRuntimeChildBootstrapAck(
  value: unknown,
): RuntimeChildBootstrapAck {
  const record = captureRecord(value, [
    "status",
    "conversationId",
    "runtimeInstanceId",
    "throughSequence",
  ], [], "bootstrap_ack");
  if (record.status !== RUNTIME_CHILD_ACK_STATUS) {
    throw new RuntimeChildPayloadError("bootstrap_ack");
  }
  return Object.freeze({
    status: RUNTIME_CHILD_ACK_STATUS,
    conversationId: captureNonBlank(record.conversationId, "bootstrap_ack"),
    runtimeInstanceId: captureNonBlank(record.runtimeInstanceId, "bootstrap_ack"),
    throughSequence: captureInteger(record.throughSequence, 0, "bootstrap_ack"),
  });
}

export function captureRuntimeChildCommandAck(
  value: unknown,
): RuntimeChildCommandAck {
  const record = captureRecord(value, ["status"], [], "command_ack");
  if (record.status !== RUNTIME_CHILD_ACK_STATUS) {
    throw new RuntimeChildPayloadError("command_ack");
  }
  return Object.freeze({ status: RUNTIME_CHILD_ACK_STATUS });
}

export type RuntimeChildPayloadKind =
  | "bootstrap"
  | "input"
  | "shutdown"
  | "bootstrap_ack"
  | "command_ack";

export class RuntimeChildPayloadError extends Error {
  readonly code = "RUNTIME_CHILD_PAYLOAD_INVALID";

  constructor(readonly payloadKind: RuntimeChildPayloadKind) {
    super("Runtime child RPC payload is invalid");
    this.name = "RuntimeChildPayloadError";
  }
}

function captureConversation(value: unknown): ConversationRuntimeBootstrap["conversation"] {
  const record = captureRecord(value, ["metadata", "activeAgentBinding"]);
  const metadata = captureRecord(record.metadata, [
    "id",
    "workspaceId",
    "rootConversationId",
    "status",
    "createdAt",
    "updatedAt",
    "lastJournalSequence",
  ], ["parentConversationId"]);
  const id = captureNonBlank(metadata.id, "bootstrap");
  const status = metadata.status;
  if (status !== "active" && status !== "archived" && status !== "disposed") {
    throw new RuntimeChildPayloadError("bootstrap");
  }
  const binding = captureRecord(record.activeAgentBinding, [
    "id",
    "conversationId",
    "revision",
    "agentType",
    "definitionVersion",
    "status",
    "createdAt",
  ], ["manifestId", "manifestDigest", "supersededAt"]);
  const bindingStatus = binding.status;
  if (
    bindingStatus !== "active" &&
    bindingStatus !== "superseded" &&
    bindingStatus !== "detached"
  ) {
    throw new RuntimeChildPayloadError("bootstrap");
  }
  if (binding.conversationId !== id) throw new RuntimeChildPayloadError("bootstrap");
  return Object.freeze({
    metadata: Object.freeze({
      id,
      workspaceId: captureNonBlank(metadata.workspaceId, "bootstrap"),
      ...(metadata.parentConversationId !== undefined
        ? { parentConversationId: captureNonBlank(metadata.parentConversationId, "bootstrap") }
        : {}),
      rootConversationId: captureNonBlank(metadata.rootConversationId, "bootstrap"),
      status,
      createdAt: captureTimestamp(metadata.createdAt, "bootstrap"),
      updatedAt: captureTimestamp(metadata.updatedAt, "bootstrap"),
      lastJournalSequence: captureInteger(metadata.lastJournalSequence, 0, "bootstrap"),
    }),
    activeAgentBinding: Object.freeze({
      id: captureNonBlank(binding.id, "bootstrap"),
      conversationId: id,
      revision: captureInteger(binding.revision, 1, "bootstrap"),
      agentType: captureNonBlank(binding.agentType, "bootstrap"),
      definitionVersion: captureNonBlank(binding.definitionVersion, "bootstrap"),
      ...(binding.manifestId !== undefined
        ? { manifestId: captureNonBlank(binding.manifestId, "bootstrap") }
        : {}),
      ...(binding.manifestDigest !== undefined
        ? { manifestDigest: captureNonBlank(binding.manifestDigest, "bootstrap") }
        : {}),
      status: bindingStatus,
      createdAt: captureTimestamp(binding.createdAt, "bootstrap"),
      ...(binding.supersededAt !== undefined
        ? { supersededAt: captureTimestamp(binding.supersededAt, "bootstrap") }
        : {}),
    }),
  });
}

function captureWorkspace(value: unknown): ConversationRuntimeBootstrap["workspace"] {
  const record = captureRecord(value, ["workspaceId", "workdir"]);
  return Object.freeze({
    workspaceId: captureNonBlank(record.workspaceId, "bootstrap"),
    workdir: captureNonBlank(record.workdir, "bootstrap"),
  });
}

function captureActivation(
  value: unknown,
  conversationId: string,
): ConversationRuntimeBootstrap["activation"] {
  const base = captureOpenRecord(value, "bootstrap");
  if (base.reason === CONVERSATION_RUNTIME_ACTIVATION_REASON.acceptedInput) {
    assertExactKeys(base, ["reason", "input"]);
    const input = captureRuntimeChildInput(base.input);
    if (input.conversationId !== conversationId) {
      throw new RuntimeChildPayloadError("bootstrap");
    }
    return Object.freeze({ reason: base.reason, input });
  }
  if (
    base.reason === CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore ||
    base.reason === CONVERSATION_RUNTIME_ACTIVATION_REASON.crashRecovery
  ) {
    assertExactKeys(base, ["reason"]);
    return Object.freeze({ reason: base.reason });
  }
  throw new RuntimeChildPayloadError("bootstrap");
}

function captureJournal(value: unknown): ConversationRuntimeBootstrap["journal"] {
  const record = captureRecord(value, ["highWatermark"]);
  return Object.freeze({
    highWatermark: captureInteger(record.highWatermark, 0, "bootstrap"),
  });
}

function captureRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  payloadKind: RuntimeChildPayloadKind = "bootstrap",
): Record<string, unknown> {
  const record = captureOpenRecord(value, payloadKind);
  assertExactKeys(record, [...required, ...optional], required, payloadKind);
  return record;
}

function captureOpenRecord(
  value: unknown,
  payloadKind: RuntimeChildPayloadKind,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeChildPayloadError(payloadKind);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RuntimeChildPayloadError(payloadKind);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new RuntimeChildPayloadError(payloadKind);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const descriptor of Object.values(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) {
      throw new RuntimeChildPayloadError(payloadKind);
    }
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[] = allowed,
  payloadKind: RuntimeChildPayloadKind = "bootstrap",
): void {
  const keys = Object.keys(record);
  if (
    keys.some((key) => !allowed.includes(key)) ||
    required.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new RuntimeChildPayloadError(payloadKind);
  }
}

function captureOptionalIdentities(
  record: Record<string, unknown>,
  fields: readonly string[],
  payloadKind: RuntimeChildPayloadKind,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of fields) {
    if (record[field] !== undefined) {
      result[field] = captureNonBlank(record[field], payloadKind);
    }
  }
  return result;
}

function captureNonBlank(
  value: unknown,
  payloadKind: RuntimeChildPayloadKind,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RuntimeChildPayloadError(payloadKind);
  }
  return value;
}

function captureTimestamp(
  value: unknown,
  payloadKind: RuntimeChildPayloadKind,
): string {
  const timestamp = captureNonBlank(value, payloadKind);
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new RuntimeChildPayloadError(payloadKind);
  }
  return timestamp;
}

function captureInteger(
  value: unknown,
  minimum: number,
  payloadKind: RuntimeChildPayloadKind,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new RuntimeChildPayloadError(payloadKind);
  }
  return value as number;
}
