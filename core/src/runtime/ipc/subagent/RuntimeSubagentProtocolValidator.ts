/**
 * 三方法 Runtime 子代理 RPC 白名单的严格不可变编解码器。
 * Strict immutable codecs for the three-method Runtime subagent RPC allowlist.
 */
import type {
  ConversationRuntimeActivationResult,
  ConversationRuntimeShutdownReason,
  ConversationRuntimeShutdownResult,
} from "../../../conversation/host/index.js";
import { isRuntimePresenceState, type RuntimePresence } from "../../../conversation/index.js";
import type { InputReceipt, JsonValue } from "../../../event/index.js";
import {
  ARTIFACT_REFERENCE_SCHEMA_VERSION,
  type ArtifactReference,
} from "../../../storage/artifact/index.js";
import {
  RuntimeSubagentProtocolError,
} from "./RuntimeSubagentErrors.js";
import {
  RUNTIME_SUBAGENT_RPC_METHOD,
  type RuntimeSubagentChildRunTerminalStatus,
  type RuntimeSubagentEnqueueRequest,
  type RuntimeSubagentEnsureActiveRequest,
  type RuntimeSubagentReadChildFinalAssistantMessageRequest,
  type RuntimeSubagentReadChildFinalAssistantMessageResponse,
  type RuntimeSubagentReadChildRunTerminalRequest,
  type RuntimeSubagentReadChildRunTerminalResponse,
  type RuntimeSubagentRpcMethod,
  type RuntimeSubagentShutdownRuntimeRequest,
} from "./RuntimeSubagentProtocol.js";

const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

/** 与生产组合策略一致的 Prompt 字节上限。Prompt byte bound aligned with the composition policy. */
const MAX_PROMPT_BYTES = 4 * 1024;
/** 与生产组合策略一致的引用数量上限。Artifact reference count bound aligned with the composition policy. */
const MAX_ARTIFACT_REFERENCES = 4;

export function isRuntimeSubagentRpcMethod(
  value: string,
): value is RuntimeSubagentRpcMethod {
  return Object.values(RUNTIME_SUBAGENT_RPC_METHOD).includes(value as never);
}

export function captureRuntimeSubagentEnsureActiveRequest(
  value: unknown,
): RuntimeSubagentEnsureActiveRequest {
  return protocolCapture(RUNTIME_SUBAGENT_RPC_METHOD.ensureActive, "invalid_request", () => {
    const record = exactRecord(value, ["conversationId"]);
    return Object.freeze({ conversationId: identity(record.conversationId) });
  });
}

export function captureRuntimeSubagentEnsureActiveResponse(
  value: unknown,
): ConversationRuntimeActivationResult {
  return protocolCapture(RUNTIME_SUBAGENT_RPC_METHOD.ensureActive, "invalid_response", () => {
    const record = exactRecord(value, ["status", "presence"]);
    const status = activationStatus(record.status);
    return Object.freeze({
      status,
      presence: capturePresence(record.presence),
    });
  });
}

export function captureRuntimeSubagentShutdownRuntimeRequest(
  value: unknown,
): RuntimeSubagentShutdownRuntimeRequest {
  return protocolCapture(RUNTIME_SUBAGENT_RPC_METHOD.shutdownRuntime, "invalid_request", () => {
    const record = exactRecord(value, ["conversationId", "reason"]);
    return Object.freeze({
      conversationId: identity(record.conversationId),
      reason: shutdownReason(record.reason),
    });
  });
}

export function captureRuntimeSubagentShutdownRuntimeResponse(
  value: unknown,
): ConversationRuntimeShutdownResult {
  return protocolCapture(RUNTIME_SUBAGENT_RPC_METHOD.shutdownRuntime, "invalid_response", () => {
    const record = exactRecord(value, ["status", "presence"]);
    const status = shutdownStatus(record.status);
    return Object.freeze({
      status,
      presence: capturePresence(record.presence),
    });
  });
}

export function captureRuntimeSubagentEnqueueRequest(
  value: unknown,
): RuntimeSubagentEnqueueRequest {
  return protocolCapture(RUNTIME_SUBAGENT_RPC_METHOD.enqueue, "invalid_request", () => {
    const record = exactRecord(value, [
      "conversationId",
      "taskId",
      "requesterConversationId",
      "prompt",
      "artifactReferences",
    ]);
    const conversationId = identity(record.conversationId);
    const taskId = identity(record.taskId);
    const artifactReferences = artifactReferenceList(record.artifactReferences);
    return Object.freeze({
      conversationId,
      taskId,
      requesterConversationId: identity(record.requesterConversationId),
      prompt: boundedText(record.prompt, MAX_PROMPT_BYTES),
      artifactReferences,
    });
  });
}

export function captureRuntimeSubagentEnqueueResponse(
  value: unknown,
  request: RuntimeSubagentEnqueueRequest,
): InputReceipt {
  return protocolCapture(RUNTIME_SUBAGENT_RPC_METHOD.enqueue, "invalid_response", () => {
    const record = exactRecord(
      value,
      ["status", "conversationId", "inputEventId", "sequence", "acceptedAt"],
    );
    if (record.status !== "accepted" && record.status !== "duplicate") {
      throw new Error();
    }
    const receipt = Object.freeze({
      status: record.status,
      conversationId: identity(record.conversationId),
      inputEventId: identity(record.inputEventId),
      sequence: positiveInteger(record.sequence),
      acceptedAt: timestamp(record.acceptedAt),
    });
    if (
      receipt.conversationId !== request.conversationId ||
      receipt.inputEventId !== `task-assigned-${request.taskId}`
    ) {
      throw new RuntimeSubagentProtocolError(
        "identity_mismatch",
        RUNTIME_SUBAGENT_RPC_METHOD.enqueue,
      );
    }
    return receipt;
  });
}

export function captureRuntimeSubagentReadChildRunTerminalRequest(
  value: unknown,
): RuntimeSubagentReadChildRunTerminalRequest {
  return protocolCapture(RUNTIME_SUBAGENT_RPC_METHOD.readChildRunTerminal, "invalid_request", () => {
    const record = exactRecord(value, ["conversationId"]);
    return Object.freeze({ conversationId: identity(record.conversationId) });
  });
}

export function captureRuntimeSubagentReadChildRunTerminalResponse(
  value: unknown,
): RuntimeSubagentReadChildRunTerminalResponse {
  return protocolCapture(RUNTIME_SUBAGENT_RPC_METHOD.readChildRunTerminal, "invalid_response", () => {
    const record = plainRecord(value);
    if (record.found === false) {
      assertExactKeys(record, ["found"]);
      return Object.freeze({ found: false });
    }
    if (record.found !== true) throw new Error();
    assertExactKeys(
      record,
      ["found", "status", "completedAt", "cancellationReason", "errorCode"],
      ["found", "status", "completedAt"],
    );
    const status = terminalRunStatus(record.status);
    return Object.freeze({
      found: true,
      status,
      completedAt: timestamp(record.completedAt),
      ...(record.cancellationReason === undefined
        ? {}
        : { cancellationReason: nonBlank(record.cancellationReason) }),
      ...(record.errorCode === undefined ? {} : { errorCode: nonBlank(record.errorCode) }),
    });
  });
}

export function captureRuntimeSubagentReadChildFinalAssistantMessageRequest(
  value: unknown,
): RuntimeSubagentReadChildFinalAssistantMessageRequest {
  return protocolCapture(RUNTIME_SUBAGENT_RPC_METHOD.readChildFinalAssistantMessage, "invalid_request", () => {
    const record = exactRecord(value, ["conversationId"]);
    return Object.freeze({ conversationId: identity(record.conversationId) });
  });
}

export function captureRuntimeSubagentReadChildFinalAssistantMessageResponse(
  value: unknown,
): RuntimeSubagentReadChildFinalAssistantMessageResponse {
  return protocolCapture(RUNTIME_SUBAGENT_RPC_METHOD.readChildFinalAssistantMessage, "invalid_response", () => {
    const record = plainRecord(value);
    if (record.found === false) {
      assertExactKeys(record, ["found"]);
      return Object.freeze({ found: false });
    }
    if (record.found !== true) throw new Error();
    assertExactKeys(record, ["found", "content"]);
    return Object.freeze({ found: true, content: nonBlank(record.content) });
  });
}

export function encodeRuntimeSubagentPayload(value: unknown): JsonValue {
  return captureJsonValue(value);
}

function capturePresence(value: unknown): RuntimePresence {
  const record = exactRecord(value, ["state", "observedAt"]);
  if (!isRuntimePresenceState(record.state)) throw new Error();
  return Object.freeze({
    state: record.state,
    observedAt: timestamp(record.observedAt),
  });
}

function artifactReferenceList(value: unknown): readonly ArtifactReference[] {
  if (!Array.isArray(value) || value.length > MAX_ARTIFACT_REFERENCES) {
    throw new Error();
  }
  return Object.freeze(value.map(captureArtifactReference));
}

function captureArtifactReference(value: unknown): ArtifactReference {
  const record = exactRecord(
    value,
    ["schemaVersion", "artifactId", "conversationId", "contentType", "byteLength", "digest"],
    ["tokenEstimate", "filename"],
  );
  if (record.schemaVersion !== ARTIFACT_REFERENCE_SCHEMA_VERSION) throw new Error();
  return Object.freeze({
    schemaVersion: ARTIFACT_REFERENCE_SCHEMA_VERSION,
    artifactId: identity(record.artifactId),
    conversationId: identity(record.conversationId),
    contentType: nonBlank(record.contentType),
    byteLength: nonNegativeInteger(record.byteLength),
    ...(record.tokenEstimate === undefined
      ? {}
      : { tokenEstimate: nonNegativeInteger(record.tokenEstimate) }),
    digest: nonBlank(record.digest),
    ...(record.filename === undefined ? {} : { filename: nonBlank(record.filename) }),
  });
}

function activationStatus(value: unknown): "activated" | "reused" {
  if (value !== "activated" && value !== "reused") throw new Error();
  return value;
}

function shutdownStatus(value: unknown): "stopped" | "already_offline" {
  if (value !== "stopped" && value !== "already_offline") throw new Error();
  return value;
}

function terminalRunStatus(value: unknown): RuntimeSubagentChildRunTerminalStatus {
  if (value !== "completed" && value !== "failed" && value !== "cancelled") {
    throw new Error();
  }
  return value;
}

function shutdownReason(value: unknown): ConversationRuntimeShutdownReason {
  if (
    value !== "explicit_shutdown" &&
    value !== "host_close" &&
    value !== "idle_eviction" &&
    value !== "replacement"
  ) {
    throw new Error();
  }
  return value;
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  const record = plainRecord(value);
  assertExactKeys(record, [...required, ...optional], required);
  return record;
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error();
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error();
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in descriptor) || !descriptor.enumerable) throw new Error();
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = allowed): void {
  const keys = Object.keys(record);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(record, key))) throw new Error();
}

function captureJsonValue(value: unknown): JsonValue {
  return captureJson(value, new Set<object>());
}

function captureJson(value: unknown, seen: Set<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error();
    return value;
  }
  if (typeof value !== "object" || seen.has(value)) throw new Error();
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length) throw new Error();
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error();
      }
      return Object.freeze(value.map((entry) => captureJson(entry, seen))) as unknown as JsonValue;
    }
    const record = plainRecord(value);
    return Object.freeze(Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, captureJson(entry, seen)])));
  } finally {
    seen.delete(value);
  }
}

function protocolCapture<T>(method: RuntimeSubagentRpcMethod, failure: "invalid_request" | "invalid_response", operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof RuntimeSubagentProtocolError) throw error;
    throw new RuntimeSubagentProtocolError(failure, method);
  }
}

function identity(value: unknown): string {
  if (typeof value !== "string" || !SAFE_IDENTITY.test(value)) throw new Error();
  return value;
}

function nonBlank(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error();
  return value;
}

function boundedText(value: unknown, maximumBytes: number): string {
  const text = nonBlank(value);
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new Error();
  return text;
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error();
  return value;
}

function positiveInteger(value: unknown): number {
  const captured = nonNegativeInteger(value);
  if (captured < 1) throw new Error();
  return captured;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error();
  return value;
}
