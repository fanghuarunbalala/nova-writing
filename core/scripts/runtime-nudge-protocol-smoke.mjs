import assert from "node:assert/strict";
import {
  NUDGE_DELIVERY,
  NUDGE_PLACEMENT,
  NUDGE_PROTOCOL_VALIDATION_FAILURE,
  NUDGE_SELECTION_LIMIT,
  NudgeProtocolValidationError,
  PENDING_NUDGE_STATE,
  captureNudgeEffect,
  captureNudgeLease,
  captureNudgeLeaseRequest,
  capturePendingNudge,
  captureSystemReminderOverlay,
  resolveNudgeSelectionLimit,
} from "../dist/index.js";

const effectSource = {
  kind: "nudge",
  policyId: "policy.max-turns",
  templateId: "runtime.max-turns",
  templateVersion: "1",
  priority: 100,
  dedupeKey: "run-1:max-turns",
  targetRunId: "run-1",
  targetTurnNumber: 8,
  parameters: {
    remainingTurns: 2,
    nested: { final: true },
  },
  cooldownTurns: 1,
  expiresAfterTurn: 9,
  expiresAt: "2026-08-01T12:00:00.000Z",
  exclusive: true,
};

const effect = captureNudgeEffect(effectSource);
assert.equal(Object.isFrozen(effect), true);
assert.equal(Object.isFrozen(effect.parameters), true);
assert.equal(Object.isFrozen(effect.parameters.nested), true);
effectSource.parameters.nested.final = false;
assert.equal(effect.parameters.nested.final, true);

const pending = capturePendingNudge({
  id: "nudge-1",
  policyId: effect.policyId,
  templateId: effect.templateId,
  templateVersion: effect.templateVersion,
  priority: effect.priority,
  dedupeKey: effect.dedupeKey,
  parameters: effect.parameters,
  exclusive: true,
  placement: NUDGE_PLACEMENT.systemPromptOverlay,
  delivery: NUDGE_DELIVERY.once,
  state: PENDING_NUDGE_STATE.scheduled,
  targetRunId: effect.targetRunId,
  targetTurnNumber: effect.targetTurnNumber,
  scheduledSequence: 41,
  scheduledAt: "2026-08-01T10:00:00.000Z",
  cooldownTurns: effect.cooldownTurns,
  expiresAfterTurn: effect.expiresAfterTurn,
  expiresAt: effect.expiresAt,
});
assert.equal(Object.isFrozen(pending), true);
assert.equal(Object.isFrozen(pending.parameters), true);

const defaultRequest = captureNudgeLeaseRequest({
  providerCallId: "provider-call-1",
  targetRunId: "run-1",
  targetTurnNumber: 8,
  requestedAt: "2026-08-01T10:01:00.000Z",
});
assert.equal(resolveNudgeSelectionLimit(defaultRequest), NUDGE_SELECTION_LIMIT.default);

const maximumRequest = captureNudgeLeaseRequest({
  ...defaultRequest,
  providerCallId: "provider-call-2",
  requestedLimit: NUDGE_SELECTION_LIMIT.maximum,
});
assert.equal(resolveNudgeSelectionLimit(maximumRequest), 2);

const lease = captureNudgeLease({
  leaseId: "lease-1",
  providerCallId: maximumRequest.providerCallId,
  targetRunId: maximumRequest.targetRunId,
  targetTurnNumber: maximumRequest.targetTurnNumber,
  nudgeIds: ["nudge-1", "nudge-2"],
  leasedAt: "2026-08-01T10:01:01.000Z",
});
assert.equal(Object.isFrozen(lease), true);
assert.equal(Object.isFrozen(lease.nudgeIds), true);

const overlay = captureSystemReminderOverlay({
  placement: NUDGE_PLACEMENT.systemPromptOverlay,
  nudgeIds: lease.nudgeIds,
  content: "temporary rendered reminder",
});
assert.equal(Object.isFrozen(overlay), true);
assert.equal(Object.isFrozen(overlay.nudgeIds), true);

assert.throws(
  () =>
    captureNudgeEffect({
      ...effectSource,
      parameters: { invalid: undefined },
    }),
  (error) =>
    error instanceof NudgeProtocolValidationError &&
    error.failure === NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidEffect &&
    error.message.includes("remainingTurns") === false,
);

assert.throws(
  () =>
    captureNudgeLeaseRequest({
      ...defaultRequest,
      requestedLimit: NUDGE_SELECTION_LIMIT.maximum + 1,
    }),
  (error) =>
    error instanceof NudgeProtocolValidationError &&
    error.failure === NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidLeaseRequest,
);

assert.throws(
  () =>
    captureNudgeLease({
      ...lease,
      nudgeIds: ["nudge-1", "nudge-1"],
    }),
  (error) =>
    error instanceof NudgeProtocolValidationError &&
    error.failure === NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidLease,
);

assert.throws(
  () =>
    captureSystemReminderOverlay({
      ...overlay,
      placement: "context-tail",
    }),
  (error) =>
    error instanceof NudgeProtocolValidationError &&
    error.failure === NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidOverlay,
);
