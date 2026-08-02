/** Validates Compaction attempt identity and outcome classification metadata. */
import {
  CONTEXT_COMPACTION_OUTCOME,
  CONTEXT_UNREDUCIBLE_REASON,
  type ContextCompactionAssessment,
  type ContextCompactionAttemptIdentity,
} from "./ContextCompactionProtocol.js";
import { CONTEXT_PROTOCOL_VALIDATION_FAILURE } from "./ContextProtocolErrors.js";
import {
  captureIdentity,
  captureNonBlank,
  deepFreeze,
  failure,
  requireBoolean,
  requireDigest,
  requireNonBlank,
  requireNonNegativeInteger,
  requirePositiveInteger,
  requireRecord,
  requireTimestamp,
} from "./ContextProtocolValidationSupport.js";

const OUTCOMES = new Set(Object.values(CONTEXT_COMPACTION_OUTCOME));
const UNREDUCIBLE_REASONS = new Set(Object.values(CONTEXT_UNREDUCIBLE_REASON));

export function captureContextCompactionAttemptIdentity(
  value: unknown,
): ContextCompactionAttemptIdentity {
  const identity = captureIdentity(value);
  try {
    const record = requireRecord(
      value,
      CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidAttemptIdentity,
      identity,
    );
    return Object.freeze({
      conversationId: requireNonBlank(record.conversationId),
      sourceDigest: requireDigest(record.sourceDigest),
      compactorId: requireNonBlank(record.compactorId),
      compactorVersion: requireNonBlank(record.compactorVersion),
    });
  } catch {
    throw failure(CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidAttemptIdentity, {
      conversationId: identity.conversationId,
    });
  }
}

export function captureContextCompactionAssessment(
  value: unknown,
): ContextCompactionAssessment {
  const identity = captureIdentity(value);
  try {
    const record = requireRecord(
      value,
      CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidAssessment,
      identity,
    );
    const outcome = record.outcome;
    if (!OUTCOMES.has(outcome as never)) throw new Error();
    const tokenEstimateBefore = requirePositiveInteger(record.tokenEstimateBefore);
    const tokenEstimateAfter = requireNonNegativeInteger(record.tokenEstimateAfter);
    const irreducibleFloorTokens = requireNonNegativeInteger(
      record.irreducibleFloorTokens,
    );
    const targetTokens = requirePositiveInteger(record.targetTokens);
    const compactionRequestTokens = requirePositiveInteger(
      record.compactionRequestTokens,
    );
    const hardAdmissionTokens = requirePositiveInteger(record.hardAdmissionTokens);
    const minimumSavingsTokens = requirePositiveInteger(record.minimumSavingsTokens);
    if (
      targetTokens >= compactionRequestTokens ||
      compactionRequestTokens >= hardAdmissionTokens ||
      irreducibleFloorTokens > tokenEstimateBefore ||
      tokenEstimateAfter < irreducibleFloorTokens
    ) {
      throw new Error();
    }
    const targetAchieved = requireBoolean(record.targetAchieved);
    const meaningfulReduction = requireBoolean(record.meaningfulReduction);
    const expectedTargetAchieved = tokenEstimateAfter <= targetTokens;
    const savings = tokenEstimateBefore - tokenEstimateAfter;
    const expectedMeaningfulReduction =
      tokenEstimateAfter < tokenEstimateBefore &&
      (savings >= minimumSavingsTokens ||
        tokenEstimateAfter === irreducibleFloorTokens ||
        expectedTargetAchieved);
    if (
      targetAchieved !== expectedTargetAchieved ||
      meaningfulReduction !== expectedMeaningfulReduction
    ) {
      throw new Error();
    }

    const checkpointId = captureNonBlank(record.checkpointId);
    if (record.checkpointId !== undefined && !checkpointId) throw new Error();
    const unreducibleReason = record.unreducibleReason;
    const isUnreducible = outcome === CONTEXT_COMPACTION_OUTCOME.unreducible;
    if (isUnreducible) {
      if (
        !UNREDUCIBLE_REASONS.has(unreducibleReason as never) ||
        checkpointId !== undefined ||
        (tokenEstimateAfter < hardAdmissionTokens && expectedMeaningfulReduction)
      ) {
        throw new Error();
      }
    } else if (unreducibleReason !== undefined || !checkpointId) {
      throw new Error();
    }

    const expectedOutcome = resolveOutcome({
      tokenEstimateAfter,
      targetTokens,
      compactionRequestTokens,
      hardAdmissionTokens,
      meaningfulReduction: expectedMeaningfulReduction,
    });
    if (outcome !== expectedOutcome) throw new Error();

    return deepFreeze({
      conversationId: requireNonBlank(record.conversationId),
      runId: requireNonBlank(record.runId),
      providerCallId: requireNonBlank(record.providerCallId),
      outcome: outcome as ContextCompactionAssessment["outcome"],
      tokenEstimateBefore,
      tokenEstimateAfter,
      irreducibleFloorTokens,
      targetTokens,
      compactionRequestTokens,
      hardAdmissionTokens,
      minimumSavingsTokens,
      targetAchieved,
      meaningfulReduction,
      ...(checkpointId === undefined ? {} : { checkpointId }),
      ...(unreducibleReason === undefined
        ? {}
        : {
            unreducibleReason:
              unreducibleReason as ContextCompactionAssessment["unreducibleReason"],
          }),
      completedAt: requireTimestamp(record.completedAt),
    });
  } catch {
    throw failure(CONTEXT_PROTOCOL_VALIDATION_FAILURE.invalidAssessment, {
      conversationId: identity.conversationId,
      runId: identity.runId,
      providerCallId: identity.providerCallId,
      checkpointId: identity.checkpointId,
    });
  }
}

function resolveOutcome(input: {
  readonly tokenEstimateAfter: number;
  readonly targetTokens: number;
  readonly compactionRequestTokens: number;
  readonly hardAdmissionTokens: number;
  readonly meaningfulReduction: boolean;
}): ContextCompactionAssessment["outcome"] {
  if (
    input.tokenEstimateAfter >= input.hardAdmissionTokens ||
    !input.meaningfulReduction
  ) {
    return CONTEXT_COMPACTION_OUTCOME.unreducible;
  }
  if (input.tokenEstimateAfter <= input.targetTokens) {
    return CONTEXT_COMPACTION_OUTCOME.targetMet;
  }
  if (input.tokenEstimateAfter < input.compactionRequestTokens) {
    return CONTEXT_COMPACTION_OUTCOME.reduced;
  }
  return CONTEXT_COMPACTION_OUTCOME.degraded;
}
