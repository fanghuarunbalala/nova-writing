/** Strict immutable capture for Subagent request, binding, and terminal result. */
import { captureArtifactReference } from "../../storage/artifact/index.js";
import {
  SUBAGENT_CANCELLATION_REASON,
  SUBAGENT_SCHEMA_VERSION,
  SUBAGENT_STATUS,
  type SubagentBinding,
  type SubagentRequest,
  type SubagentResult,
  type SubagentStatus,
  type SubagentTerminalStatus,
} from "./SubagentProtocol.js";
import {
  SUBAGENT_PROTOCOL_FAILURE,
  SubagentProtocolError,
  type SubagentProtocolFailure,
} from "./SubagentProtocolErrors.js";

const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,127}$/;
const MAX_OBJECTIVE_BYTES = 16 * 1024;

/** 子代理结果 summary 的最大字节数；超限文本由 clampSubagentText 截断，绝不 throw。
 * Maximum bytes for a subagent result summary; over-limit text is clamped, never
 * rejected, so a long final message cannot strand a binding in `running`.
 * 与 SubagentLifecyclePayloads.MAX_SUMMARY_BYTES 及 NOVEL_SUBAGENT_LIMITS.maximumResultBytes
 * 保持一致。Kept in sync with the event payload and task-limits caps. */
export const SUBAGENT_SUMMARY_MAX_BYTES = 128 * 1024;
const MAX_SUMMARY_BYTES = SUBAGENT_SUMMARY_MAX_BYTES;

/**
 * 超限文本的字节安全截断：上限内原样返回；超限时截取最长 UTF-8 安全前缀并追加稳定标记，
 * 保证最终字节数 ≤ maximumBytes。Byte-safe clamp: returns in-limit text unchanged,
 * otherwise keeps the longest UTF-8-safe prefix that fits `maximumBytes - markerBytes`
 * and appends a stable truncation marker.
 */
export function clampSubagentText(value: string, maximumBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value).byteLength;
  if (bytes <= maximumBytes) return value;
  const marker = `\n...truncated(${bytes} bytes)`;
  const budget = maximumBytes - encoder.encode(marker).byteLength;
  if (budget <= 0) return value.slice(0, maximumBytes);
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encoder.encode(value.slice(0, mid)).byteLength <= budget) low = mid;
    else high = mid - 1;
  }
  return value.slice(0, low) + marker;
}

export function captureSubagentRequest(value: unknown): SubagentRequest {
  return captureProtocol(value, SUBAGENT_PROTOCOL_FAILURE.invalidRequest, (record) => {
    exactKeys(record, [
      "schemaVersion", "subagentId", "parentConversationId", "parentRunId",
      "agentType", "definitionVersion", "objective", "toolPolicyId", "requestedAt",
    ], ["parentTurnId", "artifactReferences"]);
    requireSchema(record.schemaVersion);
    if (record.artifactReferences !== undefined &&
        !Array.isArray(record.artifactReferences)) throw new Error();
    const artifactReferences = record.artifactReferences === undefined
      ? undefined
      : Object.freeze(
          record.artifactReferences.map((artifact) =>
            captureArtifactReference(artifact),
          ),
        );
    return Object.freeze({
      schemaVersion: SUBAGENT_SCHEMA_VERSION,
      subagentId: identity(record.subagentId),
      parentConversationId: identity(record.parentConversationId),
      parentRunId: identity(record.parentRunId),
      ...(record.parentTurnId === undefined ? {} : { parentTurnId: identity(record.parentTurnId) }),
      agentType: boundedNonBlank(record.agentType, 128),
      definitionVersion: boundedNonBlank(record.definitionVersion, 128),
      objective: boundedNonBlank(record.objective, MAX_OBJECTIVE_BYTES),
      toolPolicyId: identity(record.toolPolicyId),
      ...(artifactReferences === undefined ? {} : { artifactReferences }),
      requestedAt: timestamp(record.requestedAt),
    });
  });
}

export function captureSubagentBinding(value: unknown): SubagentBinding {
  return captureProtocol(value, SUBAGENT_PROTOCOL_FAILURE.invalidBinding, (record) => {
    exactKeys(record, [
      "schemaVersion", "subagentId", "parentConversationId", "parentRunId",
      "childConversationId", "depth", "agentType", "definitionVersion",
      "toolPolicyId", "status", "createdAt", "updatedAt",
    ], ["parentTurnId"]);
    requireSchema(record.schemaVersion);
    if (record.depth !== 1) throw new Error();
    const createdAt = timestamp(record.createdAt);
    const updatedAt = timestamp(record.updatedAt);
    if (updatedAt < createdAt) throw new Error();
    return Object.freeze({
      schemaVersion: SUBAGENT_SCHEMA_VERSION,
      subagentId: identity(record.subagentId),
      parentConversationId: identity(record.parentConversationId),
      parentRunId: identity(record.parentRunId),
      ...(record.parentTurnId === undefined ? {} : { parentTurnId: identity(record.parentTurnId) }),
      childConversationId: identity(record.childConversationId),
      depth: 1,
      agentType: boundedNonBlank(record.agentType, 128),
      definitionVersion: boundedNonBlank(record.definitionVersion, 128),
      toolPolicyId: identity(record.toolPolicyId),
      status: status(record.status),
      createdAt,
      updatedAt,
    });
  });
}

export function captureSubagentResult(
  value: unknown,
  expected?: Pick<SubagentBinding, "subagentId" | "parentConversationId" | "parentRunId" | "childConversationId">,
): SubagentResult {
  const result = captureProtocol(value, SUBAGENT_PROTOCOL_FAILURE.invalidResult, (record) => {
    exactKeys(record, [
      "schemaVersion", "subagentId", "parentConversationId", "parentRunId",
      "childConversationId", "status", "artifactReferences", "completedAt",
    ], ["summary", "errorCode", "cancellationReason"]);
    requireSchema(record.schemaVersion);
    requireDenseArray(record.artifactReferences);
    const childConversationId = identity(record.childConversationId);
    const artifacts = Object.freeze(record.artifactReferences.map((artifact) => {
      assertArtifactKeys(artifact);
      const captured = captureArtifactReference(artifact);
      if (captured.conversationId !== childConversationId) throw new Error();
      return captured;
    }));
    const terminal = terminalStatus(record.status);
    const summary = record.summary === undefined
      ? undefined
      : boundedNonBlank(record.summary, MAX_SUMMARY_BYTES);
    const errorCode = record.errorCode === undefined ? undefined : safeCode(record.errorCode);
    const cancellationReason = record.cancellationReason === undefined
      ? undefined
      : cancellation(record.cancellationReason);
    if (terminal === SUBAGENT_STATUS.completed && summary === undefined && artifacts.length === 0) throw new Error();
    if ((terminal === SUBAGENT_STATUS.failed) !== (errorCode !== undefined)) throw new Error();
    if (
      (terminal === SUBAGENT_STATUS.cancelled || terminal === SUBAGENT_STATUS.orphaned) !==
      (cancellationReason !== undefined)
    ) throw new Error();
    return deepFreeze({
      schemaVersion: SUBAGENT_SCHEMA_VERSION,
      subagentId: identity(record.subagentId),
      parentConversationId: identity(record.parentConversationId),
      parentRunId: identity(record.parentRunId),
      childConversationId,
      status: terminal,
      ...(summary === undefined ? {} : { summary }),
      artifactReferences: artifacts,
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(cancellationReason === undefined ? {} : { cancellationReason }),
      completedAt: timestamp(record.completedAt),
    });
  });
  if (expected !== undefined && (
    result.subagentId !== expected.subagentId ||
    result.parentConversationId !== expected.parentConversationId ||
    result.parentRunId !== expected.parentRunId ||
    result.childConversationId !== expected.childConversationId
  )) {
    throw new SubagentProtocolError(
      SUBAGENT_PROTOCOL_FAILURE.identityMismatch,
      result.subagentId,
    );
  }
  return result;
}

export function isSubagentTerminalStatus(value: SubagentStatus): value is SubagentTerminalStatus {
  return value === "completed" || value === "failed" || value === "cancelled" || value === "orphaned";
}

function captureProtocol<T>(
  value: unknown,
  failure: SubagentProtocolFailure,
  capture: (record: Record<string, unknown>) => T,
): T {
  const record = plainRecord(value);
  const id = safeIdentity(record?.subagentId);
  try {
    if (!record) throw new Error();
    return capture(record);
  } catch (error) {
    if (error instanceof SubagentProtocolError) throw error;
    throw new SubagentProtocolError(failure, id);
  }
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  if (Object.getOwnPropertySymbols(value).length > 0) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => !("value" in descriptor) || !descriptor.enumerable)) return undefined;
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = [...required, ...optional];
  const keys = Object.keys(record);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(record, key))) throw new Error();
}

function requireSchema(value: unknown): void {
  if (value !== SUBAGENT_SCHEMA_VERSION) throw new Error();
}

function identity(value: unknown): string {
  if (typeof value !== "string" || !IDENTITY.test(value)) throw new Error();
  return value;
}

function safeIdentity(value: unknown): string | undefined {
  return typeof value === "string" && IDENTITY.test(value) ? value : undefined;
}

function boundedNonBlank(value: unknown, maximumBytes: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || new TextEncoder().encode(value).byteLength > maximumBytes) throw new Error();
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error();
  return value;
}

function safeCode(value: unknown): string {
  if (typeof value !== "string" || !SAFE_CODE.test(value)) throw new Error();
  return value;
}

function status(value: unknown): SubagentStatus {
  if (!Object.values(SUBAGENT_STATUS).includes(value as never)) throw new Error();
  return value as SubagentStatus;
}

function terminalStatus(value: unknown): SubagentTerminalStatus {
  const captured = status(value);
  if (!isSubagentTerminalStatus(captured)) throw new Error();
  return captured;
}

function cancellation(value: unknown) {
  if (!Object.values(SUBAGENT_CANCELLATION_REASON).includes(value as never)) throw new Error();
  return value as (typeof SUBAGENT_CANCELLATION_REASON)[keyof typeof SUBAGENT_CANCELLATION_REASON];
}

function assertArtifactKeys(value: unknown): void {
  const record = plainRecord(value);
  if (!record) throw new Error();
  exactKeys(record, ["schemaVersion", "artifactId", "conversationId", "contentType", "byteLength", "digest"], ["tokenEstimate", "filename"]);
}

function requireDenseArray(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length) throw new Error();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error();
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
