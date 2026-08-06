/** Strict immutable capture for Subagent Task definitions, arguments, and query values. */
import { captureArtifactReference } from "../../storage/artifact/index.js";
import type { SubagentDefinitionReader } from "./SubagentDefinitionCatalog.js";
import {
  SUBAGENT_TASK_PROTOCOL_FAILURE,
  SubagentTaskProtocolError,
  type SubagentTaskProtocolFailure,
} from "./SubagentTaskProtocolErrors.js";
import {
  SUBAGENT_RUNTIME_PRESENCE,
  SUBAGENT_TASK_CANCELLATION_STATUS,
  SUBAGENT_TASK_OUTPUT_LIMITS,
  SUBAGENT_TASK_SCHEMA_VERSION,
  SUBAGENT_TASK_STATUS,
  type SubagentDefinition,
  type SubagentTaskAcceptance,
  type SubagentTaskArguments,
  type SubagentTaskCancellation,
  type SubagentTaskCancelArguments,
  type SubagentTaskGetArguments,
  type SubagentTaskLimits,
  type SubagentTaskOutputArguments,
  type SubagentTaskSnapshot,
  type SubagentToolCompositionPolicy,
} from "./SubagentTaskProtocol.js";

const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,127}$/;
const textEncoder = new TextEncoder();

export function captureSubagentDefinition(value: unknown): SubagentDefinition {
  return capture(value, SUBAGENT_TASK_PROTOCOL_FAILURE.invalidDefinition, (record) => {
    exactKeys(record, [
      "agentType",
      "definitionVersion",
      "label",
      "description",
      "toolPolicyId",
    ]);
    return Object.freeze({
      agentType: boundedNonBlank(record.agentType, 128),
      definitionVersion: boundedNonBlank(record.definitionVersion, 128),
      label: boundedNonBlank(record.label, 256),
      description: boundedNonBlank(record.description, 4096),
      toolPolicyId: identity(record.toolPolicyId),
    });
  });
}

export function captureSubagentTaskLimits(value: unknown): SubagentTaskLimits {
  return capture(value, SUBAGENT_TASK_PROTOCOL_FAILURE.invalidLimits, (record) => {
    exactKeys(record, [
      "maximumPromptBytes",
      "maximumArtifactReferences",
      "maximumResultBytes",
    ]);
    return Object.freeze({
      maximumPromptBytes: positiveInteger(record.maximumPromptBytes),
      maximumArtifactReferences: nonNegativeInteger(record.maximumArtifactReferences),
      maximumResultBytes: positiveInteger(record.maximumResultBytes),
    });
  });
}

export function captureSubagentToolCompositionPolicy(
  value: unknown,
  definitions: SubagentDefinitionReader,
): SubagentToolCompositionPolicy {
  return capture(value, SUBAGENT_TASK_PROTOCOL_FAILURE.invalidPolicy, (record) => {
    exactKeys(record, ["allowedAgentTypes", "limits"]);
    if (!Array.isArray(record.allowedAgentTypes) || record.allowedAgentTypes.length === 0) {
      throw new Error();
    }
    const allowedAgentTypes = record.allowedAgentTypes.map((entry) =>
      definitions.require(identity(entry)),
    ).map((definition) => definition.agentType);
    if (new Set(allowedAgentTypes).size !== allowedAgentTypes.length) throw new Error();
    allowedAgentTypes.sort();
    return Object.freeze({
      allowedAgentTypes: Object.freeze(allowedAgentTypes),
      limits: captureSubagentTaskLimits(record.limits),
    });
  });
}

export function captureSubagentTaskArguments(
  value: unknown,
  options: {
    readonly definitions: SubagentDefinitionReader;
    readonly policy: SubagentToolCompositionPolicy;
  },
): SubagentTaskArguments {
  return capture(value, SUBAGENT_TASK_PROTOCOL_FAILURE.invalidArguments, (record) => {
    exactKeys(record, ["agentType", "prompt"], ["artifactIds"]);
    const agentType = identity(record.agentType);
    if (!options.policy.allowedAgentTypes.includes(agentType)) throw new Error();
    options.definitions.require(agentType);
    const prompt = boundedNonBlank(record.prompt, options.policy.limits.maximumPromptBytes);
    const artifactIds = record.artifactIds === undefined
      ? undefined
      : identityList(
          record.artifactIds,
          options.policy.limits.maximumArtifactReferences,
        );
    return Object.freeze({
      agentType,
      prompt,
      ...(artifactIds === undefined ? {} : { artifactIds }),
    });
  });
}

export function captureSubagentTaskGetArguments(
  value: unknown,
): SubagentTaskGetArguments {
  return capture(value, SUBAGENT_TASK_PROTOCOL_FAILURE.invalidArguments, (record) => {
    exactKeys(record, ["taskId"]);
    return Object.freeze({ taskId: identity(record.taskId) });
  });
}

export const captureSubagentTaskCancelArguments = captureSubagentTaskGetArguments;

export function captureSubagentTaskOutputArguments(
  value: unknown,
): SubagentTaskOutputArguments {
  return capture(
    value,
    SUBAGENT_TASK_PROTOCOL_FAILURE.invalidArguments,
    (record) => {
      exactKeys(record, ["runIds"], ["block", "timeout"]);
      const runIds = identityList(
        record.runIds,
        SUBAGENT_TASK_OUTPUT_LIMITS.maximumRunIds,
      );
      if (runIds.length === 0) throw new Error();
      const block = booleanValue(record.block);
      const timeout =
        record.timeout === undefined
          ? SUBAGENT_TASK_OUTPUT_LIMITS.defaultTimeoutMs
          : timeoutValue(record.timeout);
      return Object.freeze({ runIds, block, timeout });
    },
  );
}

export function captureSubagentTaskAcceptance(
  value: unknown,
): SubagentTaskAcceptance {
  return capture(value, SUBAGENT_TASK_PROTOCOL_FAILURE.invalidAcceptance, (record) => {
    exactKeys(record, [
      "schemaVersion",
      "taskId",
      "childConversationId",
      "status",
      "acceptedAt",
    ]);
    requireSchemaVersion(record.schemaVersion);
    if (record.status !== SUBAGENT_TASK_STATUS.queued &&
        record.status !== SUBAGENT_TASK_STATUS.running) throw new Error();
    return Object.freeze({
      schemaVersion: SUBAGENT_TASK_SCHEMA_VERSION,
      taskId: identity(record.taskId),
      childConversationId: identity(record.childConversationId),
      status: record.status,
      acceptedAt: timestamp(record.acceptedAt),
    });
  });
}

export function captureSubagentTaskSnapshot(
  value: unknown,
  limitsSource: SubagentTaskLimits,
): SubagentTaskSnapshot {
  const limits = captureSubagentTaskLimits(limitsSource);
  return capture(value, SUBAGENT_TASK_PROTOCOL_FAILURE.invalidSnapshot, (record) => {
    exactKeys(record, [
      "schemaVersion",
      "taskId",
      "childConversationId",
      "status",
      "runtimePresence",
    ], ["result", "errorCode"]);
    requireSchemaVersion(record.schemaVersion);
    const status = enumValue(record.status, Object.values(SUBAGENT_TASK_STATUS));
    const runtimePresence = enumValue(
      record.runtimePresence,
      Object.values(SUBAGENT_RUNTIME_PRESENCE),
    );
    const result = record.result === undefined
      ? undefined
      : captureResult(record.result, limits);
    const errorCode = record.errorCode === undefined
      ? undefined
      : safeCode(record.errorCode);
    return Object.freeze({
      schemaVersion: SUBAGENT_TASK_SCHEMA_VERSION,
      taskId: identity(record.taskId),
      childConversationId: identity(record.childConversationId),
      status,
      runtimePresence,
      ...(result === undefined ? {} : { result }),
      ...(errorCode === undefined ? {} : { errorCode }),
    });
  });
}

export function captureSubagentTaskCancellation(
  value: unknown,
): SubagentTaskCancellation {
  return capture(value, SUBAGENT_TASK_PROTOCOL_FAILURE.invalidCancellation, (record) => {
    exactKeys(record, ["schemaVersion", "taskId", "status"]);
    requireSchemaVersion(record.schemaVersion);
    return Object.freeze({
      schemaVersion: SUBAGENT_TASK_SCHEMA_VERSION,
      taskId: identity(record.taskId),
      status: enumValue(
        record.status,
        Object.values(SUBAGENT_TASK_CANCELLATION_STATUS),
      ),
    });
  });
}

function captureResult(
  value: unknown,
  limits: SubagentTaskLimits,
) {
  const record = plainRecord(value);
  exactKeys(record, ["content", "artifactReferences"]);
  const content = boundedString(record.content, limits.maximumResultBytes);
  if (!Array.isArray(record.artifactReferences) ||
      record.artifactReferences.length > limits.maximumArtifactReferences) {
    throw new Error();
  }
  const artifactReferences = Object.freeze(
    record.artifactReferences.map((reference) => captureArtifactReference(reference)),
  );
  return Object.freeze({ content, artifactReferences });
}

function capture<T>(
  value: unknown,
  failure: SubagentTaskProtocolFailure,
  operation: (record: Record<string, unknown>) => T,
): T {
  try {
    return operation(plainRecord(value));
  } catch (error) {
    if (error instanceof SubagentTaskProtocolError &&
        error.failure === failure) throw error;
    throw new SubagentTaskProtocolError(failure);
  }
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
       Object.getPrototypeOf(value) !== null)) throw new Error();
  return value as Record<string, unknown>;
}

function exactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new Error();
  if (required.some((key) => !(key in record))) throw new Error();
}

function identity(value: unknown): string {
  if (typeof value !== "string" || !IDENTITY.test(value)) throw new Error();
  return value;
}

function identityList(value: unknown, maximumItems: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) throw new Error();
  const items = value.map(identity);
  if (new Set(items).size !== items.length) throw new Error();
  return Object.freeze(items);
}

function boundedNonBlank(value: unknown, maximumBytes: number): string {
  const captured = boundedString(value, maximumBytes);
  if (captured.trim().length === 0) throw new Error();
  return captured;
}

function boundedString(value: unknown, maximumBytes: number): string {
  if (typeof value !== "string" || textEncoder.encode(value).byteLength > maximumBytes) {
    throw new Error();
  }
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error();
  return value as number;
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error();
  return value as number;
}

function booleanValue(value: unknown): boolean {
  if (value !== undefined && typeof value !== "boolean") throw new Error();
  return value === true;
}

function timeoutValue(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > SUBAGENT_TASK_OUTPUT_LIMITS.maximumTimeoutMs
  ) {
    throw new Error();
  }
  return value as number;
}

function requireSchemaVersion(value: unknown): void {
  if (value !== SUBAGENT_TASK_SCHEMA_VERSION) throw new Error();
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error();
  return value;
}

function safeCode(value: unknown): string {
  if (typeof value !== "string" || !SAFE_CODE.test(value)) throw new Error();
  return value;
}

function enumValue<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error();
  return value as T;
}
