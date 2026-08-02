/** Validates and freezes Context budget, estimate, floor, and pressure values. */
import {
  CONTEXT_PRESSURE_LEVEL,
  type ContextBudgetThresholds,
  type ContextInputTokenEstimate,
  type ContextIrreducibleFloorEstimate,
  type ContextPressureLevel,
  type ContextPressureSnapshot,
  type EffectiveContextBudget,
} from "./ContextBudgetProtocol.js";
import { CONTEXT_PROTOCOL_VALIDATION_FAILURE } from "./ContextProtocolErrors.js";
import {
  captureIdentity,
  deepFreeze,
  failure,
  numbersEqual,
  requireFiniteRatio,
  requireNonBlank,
  requireNonNegativeInteger,
  requirePositiveInteger,
  requireRecord,
  requireTimestamp,
} from "./ContextProtocolValidationSupport.js";

export function captureContextBudgetThresholds(
  value: unknown,
): ContextBudgetThresholds {
  try {
    const record = requireRecord(
      value,
      CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidBudgetThresholds,
    );
    const thresholds: ContextBudgetThresholds = {
      softReminderRatio: requireFiniteRatio(record.softReminderRatio),
      compactionRequestRatio: requireFiniteRatio(record.compactionRequestRatio),
      targetPostCompactionRatio: requireFiniteRatio(
        record.targetPostCompactionRatio,
      ),
      hardAdmissionRatio: requireFiniteRatio(record.hardAdmissionRatio),
      minimumNewContentRatio: requireFiniteRatio(record.minimumNewContentRatio),
      minimumNewContentTokens: requirePositiveInteger(
        record.minimumNewContentTokens,
      ),
      minimumSavingsRatio: requireFiniteRatio(record.minimumSavingsRatio),
      minimumSavingsTokens: requirePositiveInteger(record.minimumSavingsTokens),
    };
    if (
      thresholds.targetPostCompactionRatio >= thresholds.softReminderRatio ||
      thresholds.softReminderRatio >= thresholds.compactionRequestRatio ||
      thresholds.compactionRequestRatio >= thresholds.hardAdmissionRatio
    ) {
      throw new Error();
    }
    return Object.freeze(thresholds);
  } catch {
    throw failure(CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidBudgetThresholds);
  }
}

export function captureEffectiveContextBudget(
  value: unknown,
): EffectiveContextBudget {
  try {
    const record = requireRecord(
      value,
      CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidEffectiveBudget,
    );
    const providerContextWindowTokens = requirePositiveInteger(
      record.providerContextWindowTokens,
    );
    const reservedOutputTokens = requireNonNegativeInteger(
      record.reservedOutputTokens,
    );
    const protocolOverheadTokens = requireNonNegativeInteger(
      record.protocolOverheadTokens,
    );
    const safetyReserveTokens = requireNonNegativeInteger(
      record.safetyReserveTokens,
    );
    const effectiveInputTokens = requirePositiveInteger(record.effectiveInputTokens);
    if (
      providerContextWindowTokens -
        reservedOutputTokens -
        protocolOverheadTokens -
        safetyReserveTokens !==
      effectiveInputTokens
    ) {
      throw new Error();
    }
    return deepFreeze({
      providerContextWindowTokens,
      reservedOutputTokens,
      protocolOverheadTokens,
      safetyReserveTokens,
      effectiveInputTokens,
      thresholds: captureContextBudgetThresholds(record.thresholds),
    });
  } catch {
    throw failure(CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidEffectiveBudget);
  }
}

export function captureContextInputTokenEstimate(
  value: unknown,
): ContextInputTokenEstimate {
  try {
    const record = requireRecord(
      value,
      CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidInputEstimate,
    );
    const estimate: ContextInputTokenEstimate = {
      baseSystemPromptTokens: requireNonNegativeInteger(
        record.baseSystemPromptTokens,
      ),
      toolSchemaTokens: requireNonNegativeInteger(record.toolSchemaTokens),
      checkpointOverlayTokens: requireNonNegativeInteger(
        record.checkpointOverlayTokens,
      ),
      nudgeReserveTokens: requireNonNegativeInteger(record.nudgeReserveTokens),
      pinnedMessageTokens: requireNonNegativeInteger(record.pinnedMessageTokens),
      currentInputTokens: requireNonNegativeInteger(record.currentInputTokens),
      recentMessageTokens: requireNonNegativeInteger(record.recentMessageTokens),
      transientMessageTokens: requireNonNegativeInteger(
        record.transientMessageTokens,
      ),
      totalInputTokens: requireNonNegativeInteger(record.totalInputTokens),
    };
    const total =
      estimate.baseSystemPromptTokens +
      estimate.toolSchemaTokens +
      estimate.checkpointOverlayTokens +
      estimate.nudgeReserveTokens +
      estimate.pinnedMessageTokens +
      estimate.currentInputTokens +
      estimate.recentMessageTokens +
      estimate.transientMessageTokens;
    if (total !== estimate.totalInputTokens) throw new Error();
    return Object.freeze(estimate);
  } catch {
    throw failure(CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidInputEstimate);
  }
}

export function captureContextIrreducibleFloorEstimate(
  value: unknown,
): ContextIrreducibleFloorEstimate {
  try {
    const record = requireRecord(
      value,
      CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidIrreducibleFloor,
    );
    const estimate: ContextIrreducibleFloorEstimate = {
      baseSystemPromptTokens: requireNonNegativeInteger(
        record.baseSystemPromptTokens,
      ),
      toolSchemaTokens: requireNonNegativeInteger(record.toolSchemaTokens),
      pinnedMessageTokens: requireNonNegativeInteger(record.pinnedMessageTokens),
      currentInputTokens: requireNonNegativeInteger(record.currentInputTokens),
      transientMessageTokens: requireNonNegativeInteger(
        record.transientMessageTokens,
      ),
      totalTokens: requireNonNegativeInteger(record.totalTokens),
    };
    const total =
      estimate.baseSystemPromptTokens +
      estimate.toolSchemaTokens +
      estimate.pinnedMessageTokens +
      estimate.currentInputTokens +
      estimate.transientMessageTokens;
    if (total !== estimate.totalTokens) throw new Error();
    return Object.freeze(estimate);
  } catch {
    throw failure(CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidIrreducibleFloor);
  }
}

export function resolveContextPressureLevel(
  usageRatio: number,
  thresholds: ContextBudgetThresholds,
): ContextPressureLevel {
  if (!Number.isFinite(usageRatio) || usageRatio < 0) {
    throw failure(CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidPressureSnapshot);
  }
  const captured = captureContextBudgetThresholds(thresholds);
  if (usageRatio >= captured.hardAdmissionRatio) {
    return CONTEXT_PRESSURE_LEVEL.hard;
  }
  if (usageRatio >= captured.compactionRequestRatio) {
    return CONTEXT_PRESSURE_LEVEL.compaction;
  }
  if (usageRatio >= captured.softReminderRatio) {
    return CONTEXT_PRESSURE_LEVEL.soft;
  }
  return CONTEXT_PRESSURE_LEVEL.normal;
}

export function captureContextPressureSnapshot(
  value: unknown,
): ContextPressureSnapshot {
  const identity = captureIdentity(value);
  try {
    const record = requireRecord(
      value,
      CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidPressureSnapshot,
      identity,
    );
    const conversationId = requireNonBlank(record.conversationId);
    const runId = requireNonBlank(record.runId);
    const providerCallId = requireNonBlank(record.providerCallId);
    const budget = captureEffectiveContextBudget(record.budget);
    const estimate = captureContextInputTokenEstimate(record.estimate);
    const irreducibleFloor = captureContextIrreducibleFloorEstimate(
      record.irreducibleFloor,
    );
    if (irreducibleFloor.totalTokens > estimate.totalInputTokens) {
      throw new Error();
    }
    const usageRatio = estimate.totalInputTokens / budget.effectiveInputTokens;
    if (
      typeof record.usageRatio !== "number" ||
      !Number.isFinite(record.usageRatio) ||
      !numbersEqual(record.usageRatio, usageRatio)
    ) {
      throw new Error();
    }
    const level = resolveContextPressureLevel(usageRatio, budget.thresholds);
    if (record.level !== level) throw new Error();
    return deepFreeze({
      conversationId,
      runId,
      providerCallId,
      evaluatedAt: requireTimestamp(record.evaluatedAt),
      budget,
      estimate,
      irreducibleFloor,
      usageRatio,
      level,
    });
  } catch {
    throw failure(CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidPressureSnapshot, {
      conversationId: identity.conversationId,
      runId: identity.runId,
      providerCallId: identity.providerCallId,
    });
  }
}
