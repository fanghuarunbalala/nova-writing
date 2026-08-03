/** Defensively captures Tool execution values before asynchronous ownership transfer. */
import {
  canonicalStringifyJson,
  isJsonValue,
  type JsonValue,
} from "../../../event/protocol/index.js";
import { isToolName } from "../../../tooling/protocol/ToolName.js";
import type {
  CapturedToolInvocation,
  ToolApprovalIdentity,
  ToolArgumentDigest,
  ToolArgumentDigester,
  ToolExecutionPolicy,
  ToolInvocation,
  ToolPermissionDecision,
  ToolTraceRecord,
} from "./ToolExecutionContracts.js";
import type { ToolErrorIdentity } from "./ToolExecutionError.js";
import {
  TOOL_EXECUTION_PROTOCOL_FAILURE,
  ToolExecutionProtocolError,
  type ToolExecutionProtocolFailure,
} from "./ToolExecutionProtocolErrors.js";

const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const TOOL_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ARGUMENT_DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,127}$/;

export async function captureToolInvocation(
  value: ToolInvocation,
  digester: ToolArgumentDigester,
): Promise<CapturedToolInvocation>;
export async function captureToolInvocation(
  value: unknown,
  digester: ToolArgumentDigester,
): Promise<CapturedToolInvocation>;
export async function captureToolInvocation(
  value: unknown,
  digester: ToolArgumentDigester,
): Promise<CapturedToolInvocation> {
  const record = asPlainRecord(value);
  const identity = invocationIdentity(record);
  try {
    if (!record) throw new Error();
    const conversationId = requireIdentity(record.conversationId);
    const runId = requireIdentity(record.runId);
    const toolCallId = requireIdentity(record.toolCallId);
    const toolName = requireToolName(record.toolName);
    const toolVersion = optionalToolVersion(record.toolVersion);
    const turnId = optionalIdentity(record.turnId);
    const arguments_ = captureJson(record.arguments);
    const argumentDigest = captureToolArgumentDigest(
      await digester.digest(arguments_),
    );
    return Object.freeze({
      conversationId,
      runId,
      toolCallId,
      ...(turnId === undefined ? {} : { turnId }),
      toolName,
      ...(toolVersion === undefined ? {} : { toolVersion }),
      arguments: arguments_,
      argumentDigest,
    });
  } catch (error) {
    if (error instanceof ToolExecutionProtocolError) throw error;
    throw failure(TOOL_EXECUTION_PROTOCOL_FAILURE.invalidInvocation, identity);
  }
}

export function captureToolArgumentDigest(value: unknown): ToolArgumentDigest {
  if (typeof value !== "string" || !ARGUMENT_DIGEST.test(value)) {
    throw failure(TOOL_EXECUTION_PROTOCOL_FAILURE.invalidArgumentDigest);
  }
  return value as ToolArgumentDigest;
}

export function captureToolExecutionPolicy(value: unknown): ToolExecutionPolicy {
  const record = asPlainRecord(value);
  try {
    if (!record) throw new Error();
    const retry = asPlainRecord(record.retry);
    if (!retry) throw new Error();
    const maximumAttempts = retry.maximumAttempts;
    if (maximumAttempts !== 1 && maximumAttempts !== 2) throw new Error();
    if (!isPositiveInteger(record.timeoutMs)) throw new Error();
    if (record.isolation !== "trusted_process" && record.isolation !== "os_process") {
      throw new Error();
    }
    if (record.cancellable !== true) throw new Error();
    const idempotent = requireBoolean(record.idempotent);
    const restartable = requireBoolean(record.restartable);
    const checkpointable = requireBoolean(record.checkpointable);
    if (!idempotent && maximumAttempts > 1) {
      throw new Error();
    }
    return Object.freeze({
      timeoutMs: record.timeoutMs,
      isolation: record.isolation,
      cancellable: true,
      idempotent,
      restartable,
      checkpointable,
      retry: Object.freeze({ maximumAttempts }),
    });
  } catch {
    throw failure(TOOL_EXECUTION_PROTOCOL_FAILURE.invalidExecutionPolicy);
  }
}

export function captureToolPermissionDecision(value: unknown): ToolPermissionDecision {
  const record = asPlainRecord(value);
  try {
    if (!record) throw new Error();
    if (record.effect !== "allow" && record.effect !== "ask" && record.effect !== "deny") {
      throw new Error();
    }
    if (typeof record.hardRestriction !== "boolean") throw new Error();
    const ruleIds = captureIdentityList(record.ruleIds);
    if (record.hardRestriction && record.effect !== "deny") throw new Error();
    return Object.freeze({
      effect: record.effect,
      ruleIds,
      hardRestriction: record.hardRestriction,
    });
  } catch {
    throw failure(TOOL_EXECUTION_PROTOCOL_FAILURE.invalidPermissionDecision);
  }
}

export function captureToolApprovalIdentity(value: unknown): ToolApprovalIdentity {
  const record = asPlainRecord(value);
  const identity = approvalIdentity(record);
  try {
    if (!record) throw new Error();
    return Object.freeze({
      conversationId: requireIdentity(record.conversationId),
      runId: requireIdentity(record.runId),
      toolCallId: requireIdentity(record.toolCallId),
      toolName: requireToolName(record.toolName),
      toolVersion: requireToolVersion(record.toolVersion),
      argumentDigest: captureToolArgumentDigest(record.argumentDigest),
    });
  } catch (error) {
    if (error instanceof ToolExecutionProtocolError) throw error;
    throw failure(TOOL_EXECUTION_PROTOCOL_FAILURE.invalidApprovalIdentity, identity);
  }
}

export function captureToolTraceRecord(value: unknown): ToolTraceRecord {
  const record = asPlainRecord(value);
  const identity = approvalIdentity(record);
  try {
    if (!record) throw new Error();
    const timestamp = requireTimestamp(record.timestamp);
    const attempt = record.attempt;
    if (!isPositiveInteger(attempt)) throw new Error();
    const trace: ToolTraceRecord = {
      traceId: requireIdentity(record.traceId),
      conversationId: requireIdentity(record.conversationId),
      runId: requireIdentity(record.runId),
      toolCallId: requireIdentity(record.toolCallId),
      ...(optionalIdentity(record.turnId) === undefined
        ? {}
        : { turnId: optionalIdentity(record.turnId) }),
      toolName: requireToolName(record.toolName),
      toolVersion: requireToolVersion(record.toolVersion),
      argumentDigest: captureToolArgumentDigest(record.argumentDigest),
      stage: requireOneOf(record.stage, [
        "received", "resolved", "validated", "permission_evaluated",
        "approval_requested", "approval_resolved", "sandbox_started",
        "execution_started", "execution_completed", "execution_failed",
        "cancelled", "timed_out",
      ] as const),
      timestamp,
      attempt,
      ...captureOptionalNonNegativeIntegerField(record, "durationMs"),
      ...captureOptionalNonNegativeIntegerField(record, "inputBytes"),
      ...captureOptionalNonNegativeIntegerField(record, "outputBytes"),
      ...(record.ruleIds === undefined ? {} : { ruleIds: captureIdentityList(record.ruleIds) }),
      ...(record.permissionEffect === undefined ? {} : {
        permissionEffect: requireOneOf(record.permissionEffect, ["allow", "ask", "deny"] as const),
      }),
      ...(record.approvalDecision === undefined ? {} : {
        approvalDecision: requireOneOf(record.approvalDecision, [
          "approved", "rejected", "cancelled", "expired",
        ] as const),
      }),
      ...(record.approvalActorId === undefined ? {} : {
        approvalActorId: requireIdentity(record.approvalActorId),
      }),
      ...(record.artifactIds === undefined ? {} : {
        artifactIds: captureIdentityList(record.artifactIds),
      }),
      ...(record.errorCategory === undefined ? {} : {
        errorCategory: requireOneOf(record.errorCategory, [
          "validation", "permission", "approval_rejected", "sandbox",
          "timeout", "cancelled", "execution", "internal",
        ] as const),
      }),
      ...(record.errorCode === undefined ? {} : {
        errorCode: requireSafeCode(record.errorCode),
      }),
      ...(record.retryable === undefined ? {} : {
        retryable: requireBoolean(record.retryable),
      }),
      ...(record.sideEffectStatus === undefined ? {} : {
        sideEffectStatus: requireOneOf(record.sideEffectStatus, [
          "none", "possible", "partial", "completed_unknown",
        ] as const),
      }),
    };
    return freezeTrace(trace);
  } catch (error) {
    if (error instanceof ToolExecutionProtocolError) throw error;
    throw failure(TOOL_EXECUTION_PROTOCOL_FAILURE.invalidTraceRecord, identity);
  }
}

export function canonicalToolArguments(arguments_: JsonValue): string {
  return canonicalStringifyJson(arguments_);
}

function captureJson(value: unknown): JsonValue {
  if (!isJsonValue(value)) throw new Error();
  return cloneAndFreezeJson(value);
}

function cloneAndFreezeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((entry) => cloneAndFreezeJson(entry)),
    ) as unknown as JsonValue;
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneAndFreezeJson(entry)]),
    ),
  );
}

function freezeTrace(trace: ToolTraceRecord): ToolTraceRecord {
  if (trace.ruleIds) Object.freeze(trace.ruleIds);
  if (trace.artifactIds) Object.freeze(trace.artifactIds);
  return Object.freeze(trace);
}

function captureIdentityList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error();
  const seen = new Set<string>();
  return Object.freeze(value.map((entry) => {
    const identity = requireIdentity(entry);
    if (seen.has(identity)) throw new Error();
    seen.add(identity);
    return identity;
  }));
}

function captureOptionalNonNegativeIntegerField(
  record: Record<string, unknown>,
  field: "durationMs" | "inputBytes" | "outputBytes",
): Readonly<Record<typeof field, number>> | Record<string, never> {
  const value = record[field];
  if (value === undefined) return {};
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error();
  return { [field]: value as number } as Readonly<Record<typeof field, number>>;
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  return value as Record<string, unknown>;
}

function requireIdentity(value: unknown): string {
  if (typeof value !== "string" || !SAFE_IDENTITY.test(value)) throw new Error();
  return value;
}

function optionalIdentity(value: unknown): string | undefined {
  return value === undefined ? undefined : requireIdentity(value);
}

function requireToolName(value: unknown): string {
  if (!isToolName(value)) throw new Error();
  return value;
}

function requireToolVersion(value: unknown): string {
  if (typeof value !== "string" || !TOOL_VERSION.test(value)) throw new Error();
  return value;
}

function optionalToolVersion(value: unknown): string | undefined {
  return value === undefined ? undefined : requireToolVersion(value);
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) throw new Error();
  return value;
}

function requireSafeCode(value: unknown): string {
  if (typeof value !== "string" || !SAFE_CODE.test(value)) throw new Error();
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error();
  return value;
}

function requireOneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error();
  return value as T[number];
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function invocationIdentity(record: Record<string, unknown> | undefined) {
  return {
    conversationId: safeIdentity(record?.conversationId),
    runId: safeIdentity(record?.runId),
    toolCallId: safeIdentity(record?.toolCallId),
    toolName: safeToolName(record?.toolName),
  };
}

function approvalIdentity(record: Record<string, unknown> | undefined) {
  return {
    ...invocationIdentity(record),
    toolVersion: safeToolVersion(record?.toolVersion),
  };
}

function safeIdentity(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_IDENTITY.test(value) ? value : undefined;
}

function safeToolName(value: unknown): string | undefined {
  return isToolName(value) ? value : undefined;
}

function safeToolVersion(value: unknown): string | undefined {
  return typeof value === "string" && TOOL_VERSION.test(value) ? value : undefined;
}

function failure(
  failureCode: ToolExecutionProtocolFailure,
  identity: ToolErrorIdentity = {},
): ToolExecutionProtocolError {
  return new ToolExecutionProtocolError(failureCode, identity);
}
