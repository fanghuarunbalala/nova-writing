/** Captures immutable Runtime Policy values and exact Context budget arithmetic. */
import { captureNudgeEffect } from "../nudge/index.js";
import {
  captureContextPressureSnapshot,
  type ContextPressureSnapshot,
} from "../context/index.js";
import {
  CONTEXT_COMPACTION_EFFECT_TRIGGER,
  RUNTIME_POLICY_PHASE,
  type ContextCompactionEffect,
  type ContextCompactionPolicyState,
  type NudgeAcknowledgePolicyEffect,
  type NudgeExpirePolicyEffect,
  type NudgeResolvePolicyEffect,
  type NudgeSchedulePolicyEffect,
  type NudgeSupersedePolicyEffect,
  type RuntimePolicyContext,
  type RuntimePolicyEffect,
  type RuntimeNudgeLifecycleEffect,
  type RuntimePolicyRuntimeSignals,
  type RuntimePolicyState,
} from "./RuntimePolicyProtocol.js";
import type { ComposeModeSnapshot } from "../compose/ComposeModeState.js";
import {
  RUNTIME_POLICY_PROTOCOL_FAILURE,
  RuntimePolicyProtocolError,
  type RuntimePolicyProtocolFailure,
} from "./RuntimePolicyProtocolErrors.js";

const PHASES = new Set(Object.values(RUNTIME_POLICY_PHASE));
const COMPACTION_TRIGGERS = new Set(
  Object.values(CONTEXT_COMPACTION_EFFECT_TRIGGER),
);
const COMPOSE_PHASES = new Set<ComposeModeSnapshot["phase"]>([
  "idle",
  "designing",
  "pending",
  "applied",
  "discarded",
]);

export function captureRuntimePolicyContext(
  value: unknown,
): RuntimePolicyContext {
  const identity = captureIdentity(value);
  try {
    const record = requireRecord(value);
    if (!PHASES.has(record.phase as never)) throw new Error();
    const conversationId = requireNonBlank(record.conversationId);
    const runId = requireNonBlank(record.runId);
    const providerCallId = requireNonBlank(record.providerCallId);
    const evaluatedAt = requireTimestamp(record.evaluatedAt);
    const contextPressure =
      record.contextPressure === undefined
        ? undefined
        : captureContextPressureSnapshot(record.contextPressure);
    if (contextPressure !== undefined) {
      assertPressureIdentity(
        contextPressure,
        conversationId,
        runId,
        providerCallId,
        evaluatedAt,
      );
    }
    return Object.freeze({
      phase: record.phase as RuntimePolicyContext["phase"],
      conversationId,
      runId,
      providerCallId,
      evaluatedAt,
      ...(contextPressure === undefined ? {} : { contextPressure }),
      ...captureRuntimePolicyRuntimeSignals(record.runtimeSignals),
    });
  } catch {
    throw failure(RUNTIME_POLICY_PROTOCOL_FAILURE.invalidContext, identity);
  }
}

function captureRuntimePolicyRuntimeSignals(
  value: unknown,
): { readonly runtimeSignals: RuntimePolicyRuntimeSignals } | {} {
  if (value === undefined) return {};
  const record = requireRecord(value);
  const providerCallCount = requireNonNegativeInteger(record.providerCallCount);
  const signals: RuntimePolicyRuntimeSignals = Object.freeze({
    providerCallCount,
    ...(record.compose === undefined
      ? {}
      : { compose: captureComposeModeSnapshot(record.compose) }),
    ...(record.todos === undefined
      ? {}
      : { todos: captureTodoSignals(record.todos) }),
  });
  return { runtimeSignals: signals };
}

function captureComposeModeSnapshot(value: unknown): ComposeModeSnapshot {
  const record = requireRecord(value);
  const phase = record.phase;
  if (
    !COMPOSE_PHASES.has(phase as never) ||
    typeof record.active !== "boolean" ||
    typeof record.mode !== "string" ||
    record.mode.trim().length === 0
  ) {
    throw new Error();
  }
  return Object.freeze({
    phase: phase as ComposeModeSnapshot["phase"],
    active: record.active,
    mode: record.mode as ComposeModeSnapshot["mode"],
    ...(typeof record.designFilePath === "string"
      ? { designFilePath: record.designFilePath }
      : {}),
    ...(typeof record.preComposeMode === "string"
      ? { preComposeMode: record.preComposeMode as ComposeModeSnapshot["mode"] }
      : {}),
  });
}

function captureTodoSignals(
  value: unknown,
): { readonly inProgressCount: number } {
  const record = requireRecord(value);
  return Object.freeze({
    inProgressCount: requireNonNegativeInteger(record.inProgressCount),
  });
}

export function captureRuntimePolicyState(value: unknown): RuntimePolicyState {
  const identity = captureIdentity(value);
  try {
    const record = requireRecord(value);
    const conversationId = requireNonBlank(record.conversationId);
    return Object.freeze({
      conversationId,
      ...(record.contextCompaction === undefined
        ? {}
        : {
            contextCompaction: captureContextCompactionPolicyState(
              record.contextCompaction,
            ),
          }),
    });
  } catch {
    throw failure(RUNTIME_POLICY_PROTOCOL_FAILURE.invalidState, identity);
  }
}

export function captureContextCompactionEffect(
  value: unknown,
): ContextCompactionEffect {
  const identity = captureIdentity(value);
  try {
    const record = requireRecord(value);
    if (record.kind !== "context_compaction") throw new Error();
    if (!COMPACTION_TRIGGERS.has(record.trigger as never)) throw new Error();
    const conversationId = requireNonBlank(record.conversationId);
    const runId = requireNonBlank(record.runId);
    const providerCallId = requireNonBlank(record.providerCallId);
    const requestedAt = requireTimestamp(record.requestedAt);
    const pressure = captureContextPressureSnapshot(record.pressure);
    assertPressureIdentity(
      pressure,
      conversationId,
      runId,
      providerCallId,
      requestedAt,
    );
    const expected = calculateContextPolicyTokenBoundaries(pressure);
    const effect = Object.freeze({
      kind: "context_compaction" as const,
      policyId: requireNonBlank(record.policyId),
      trigger: record.trigger as ContextCompactionEffect["trigger"],
      conversationId,
      runId,
      providerCallId,
      requestedAt,
      pressure,
      targetTokens: requirePositiveInteger(record.targetTokens),
      compactionRequestTokens: requirePositiveInteger(
        record.compactionRequestTokens,
      ),
      hardAdmissionTokens: requirePositiveInteger(record.hardAdmissionTokens),
      minimumSavingsTokens: requirePositiveInteger(record.minimumSavingsTokens),
      automaticHysteresisTokens: requirePositiveInteger(
        record.automaticHysteresisTokens,
      ),
    });
    if (
      effect.targetTokens !== expected.targetTokens ||
      effect.compactionRequestTokens !== expected.compactionRequestTokens ||
      effect.hardAdmissionTokens !== expected.hardAdmissionTokens ||
      effect.minimumSavingsTokens !== expected.minimumSavingsTokens ||
      effect.automaticHysteresisTokens !== expected.automaticHysteresisTokens
    ) {
      throw new Error();
    }
    return effect;
  } catch {
    throw failure(RUNTIME_POLICY_PROTOCOL_FAILURE.invalidEffect, identity);
  }
}

export function captureRuntimePolicyEffect(value: unknown): RuntimePolicyEffect {
  const record = requireRecordOrFailure(value);
  if (record.kind === "nudge") {
    try {
      return captureNudgeEffect(value);
    } catch {
      throw failure(
        RUNTIME_POLICY_PROTOCOL_FAILURE.invalidEffect,
        captureIdentity(value),
      );
    }
  }
  if (
    record.kind === "nudge_schedule" ||
    record.kind === "nudge_acknowledge" ||
    record.kind === "nudge_resolve" ||
    record.kind === "nudge_expire" ||
    record.kind === "nudge_supersede"
  ) {
    try {
      return captureRuntimeNudgeLifecycleEffect(value);
    } catch {
      throw failure(
        RUNTIME_POLICY_PROTOCOL_FAILURE.invalidEffect,
        captureIdentity(value),
      );
    }
  }
  return captureContextCompactionEffect(value);
}

export function captureRuntimeNudgeLifecycleEffect(
  value: unknown,
): RuntimeNudgeLifecycleEffect {
  const record = requireRecord(value);
  const kind = record.kind;
  const policyId = requireNonBlank(record.policyId);
  const conversationId = requireNonBlank(record.conversationId);
  const runId = requireNonBlank(record.runId);
  if (kind === "nudge_schedule") {
    const effect = captureNudgeEffect(record.effect);
    const nudgeId = requireNonBlank(record.nudgeId);
    const scheduledSequence = requirePositiveInteger(record.scheduledSequence);
    const scheduledAt = requireTimestamp(record.scheduledAt);
    if (
      effect.policyId !== policyId ||
      effect.targetRunId !== runId ||
      !nudgeId
    ) throw new Error();
    return Object.freeze({
      kind,
      policyId,
      conversationId,
      runId,
      nudgeId,
      effect,
      scheduledSequence,
      scheduledAt,
    } satisfies NudgeSchedulePolicyEffect);
  }
  if (kind === "nudge_acknowledge") {
    return Object.freeze({
      kind,
      policyId,
      conversationId,
      runId,
      nudgeId: requireNonBlank(record.nudgeId),
      acknowledgementRef: captureReference(record.acknowledgementRef),
      acknowledgedAt: requireTimestamp(record.acknowledgedAt),
    } satisfies NudgeAcknowledgePolicyEffect);
  }
  if (kind === "nudge_resolve") {
    return Object.freeze({
      kind,
      policyId,
      conversationId,
      runId,
      nudgeId: requireNonBlank(record.nudgeId),
      conditionRef: captureReference(record.conditionRef),
      resolvedAt: requireTimestamp(record.resolvedAt),
    } satisfies NudgeResolvePolicyEffect);
  }
  if (kind === "nudge_expire") {
    const targetRunId = requireNonBlank(record.targetRunId);
    if (targetRunId !== runId) throw new Error();
    return Object.freeze({
      kind,
      policyId,
      conversationId,
      runId,
      targetRunId,
      evaluatedAt: requireTimestamp(record.evaluatedAt),
      ...captureOptionalPositiveInteger(record.currentTurnNumber),
      ...captureOptionalBoolean(record.runEnded),
    } satisfies NudgeExpirePolicyEffect);
  }
  if (kind === "nudge_supersede") {
    const nudgeId = requireNonBlank(record.nudgeId);
    const targetRunId = requireNonBlank(record.targetRunId);
    const supersededByNudgeId = requireNonBlank(record.supersededByNudgeId);
    if (targetRunId !== runId || nudgeId === supersededByNudgeId) throw new Error();
    return Object.freeze({
      kind,
      policyId,
      conversationId,
      runId,
      nudgeId,
      targetRunId,
      supersededByNudgeId,
      supersededAt: requireTimestamp(record.supersededAt),
    } satisfies NudgeSupersedePolicyEffect);
  }
  throw new Error();
}

export function calculateContextPolicyTokenBoundaries(
  pressure: ContextPressureSnapshot,
): Readonly<{
  targetTokens: number;
  compactionRequestTokens: number;
  hardAdmissionTokens: number;
  minimumSavingsTokens: number;
  automaticHysteresisTokens: number;
}> {
  const capturedPressure = captureContextPressureSnapshot(pressure);
  const effectiveTokens = capturedPressure.budget.effectiveInputTokens;
  const thresholds = capturedPressure.budget.thresholds;
  return Object.freeze({
    targetTokens: Math.floor(
      effectiveTokens * thresholds.targetPostCompactionRatio,
    ),
    compactionRequestTokens: Math.ceil(
      effectiveTokens * thresholds.compactionRequestRatio,
    ),
    hardAdmissionTokens: Math.ceil(
      effectiveTokens * thresholds.hardAdmissionRatio,
    ),
    minimumSavingsTokens: Math.max(
      Math.ceil(effectiveTokens * thresholds.minimumSavingsRatio),
      thresholds.minimumSavingsTokens,
    ),
    automaticHysteresisTokens: Math.max(
      Math.ceil(effectiveTokens * thresholds.minimumNewContentRatio),
      thresholds.minimumNewContentTokens,
    ),
  });
}

function captureContextCompactionPolicyState(
  value: unknown,
): ContextCompactionPolicyState {
  const record = requireRecord(value);
  return Object.freeze({
    lastAutomaticCompactionAt: requireTimestamp(
      record.lastAutomaticCompactionAt,
    ),
    newContentSinceLastAutomaticCompactionTokens: requireNonNegativeInteger(
      record.newContentSinceLastAutomaticCompactionTokens,
    ),
  });
}

function assertPressureIdentity(
  pressure: ContextPressureSnapshot,
  conversationId: string,
  runId: string,
  providerCallId: string,
  evaluatedAt: string,
): void {
  if (
    pressure.conversationId !== conversationId ||
    pressure.runId !== runId ||
    pressure.providerCallId !== providerCallId ||
    pressure.evaluatedAt !== evaluatedAt
  ) {
    throw new Error();
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error();
  }
  return value as Record<string, unknown>;
}

function requireRecordOrFailure(value: unknown): Record<string, unknown> {
  try {
    return requireRecord(value);
  } catch {
    throw failure(
      RUNTIME_POLICY_PROTOCOL_FAILURE.invalidEffect,
      captureIdentity(value),
    );
  }
}

function requireNonBlank(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error();
  return value;
}

function captureReference(value: unknown): {
  readonly id: string;
  readonly version: string;
} {
  const record = requireRecord(value);
  const id = requireNonBlank(record.id);
  const version = requireNonBlank(record.version);
  return Object.freeze({ id, version });
}

function requireTimestamp(value: unknown): string {
  const timestamp = requireNonBlank(value);
  if (
    !Number.isFinite(Date.parse(timestamp)) ||
    new Date(timestamp).toISOString() !== timestamp
  ) {
    throw new Error();
  }
  return timestamp;
}

function requirePositiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error();
  return value as number;
}

function requireNonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error();
  return value as number;
}

function captureOptionalPositiveInteger(
  value: unknown,
): { readonly currentTurnNumber?: number } {
  if (value === undefined) return {};
  return { currentTurnNumber: requirePositiveInteger(value) };
}

function captureOptionalBoolean(
  value: unknown,
): { readonly runEnded?: boolean } {
  if (value === undefined) return {};
  if (typeof value !== "boolean") throw new Error();
  return { runEnded: value };
}

function captureIdentity(value: unknown): {
  conversationId?: string;
  runId?: string;
  providerCallId?: string;
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.conversationId === "string"
      ? { conversationId: record.conversationId }
      : {}),
    ...(typeof record.runId === "string" ? { runId: record.runId } : {}),
    ...(typeof record.providerCallId === "string"
      ? { providerCallId: record.providerCallId }
      : {}),
  };
}

function failure(
  reason: RuntimePolicyProtocolFailure,
  identity: {
    conversationId?: string;
    runId?: string;
    providerCallId?: string;
  },
): RuntimePolicyProtocolError {
  return new RuntimePolicyProtocolError(
    reason,
    identity.conversationId,
    identity.runId,
    identity.providerCallId,
  );
}
