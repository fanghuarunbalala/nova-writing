import assert from "node:assert/strict";
import {
  NUDGE_DELIVERY,
  NUDGE_PROTOCOL_VALIDATION_FAILURE,
  NudgeProtocolValidationError,
  captureNudgeEffect,
  capturePendingNudge,
} from "../dist/index.js";

const legacyEffect = captureNudgeEffect({
  kind: "nudge",
  policyId: "policy.legacy",
  templateId: "runtime.legacy",
  templateVersion: "1.0.0",
  priority: 10,
  dedupeKey: "legacy",
  targetRunId: "run-1",
  parameters: { remainingTurns: 1 },
});
assert.equal(legacyEffect.delivery, NUDGE_DELIVERY.once);
assert.equal(legacyEffect.acknowledgementRef, undefined);
assert.equal(legacyEffect.conditionRef, undefined);

const legacyPending = capturePendingNudge({
  id: "nudge-legacy",
  policyId: legacyEffect.policyId,
  templateId: legacyEffect.templateId,
  templateVersion: legacyEffect.templateVersion,
  priority: legacyEffect.priority,
  dedupeKey: legacyEffect.dedupeKey,
  parameters: legacyEffect.parameters,
  exclusive: false,
  placement: "system-prompt-overlay",
  state: "scheduled",
  targetRunId: legacyEffect.targetRunId,
  scheduledSequence: 1,
  scheduledAt: "2026-08-03T00:00:00.000Z",
});
assert.equal(legacyPending.delivery, NUDGE_DELIVERY.once);

const acknowledged = captureNudgeEffect({
  ...legacyEffect,
  delivery: NUDGE_DELIVERY.untilAcknowledged,
  acknowledgementRef: { id: "ack.tool-result", version: "1.0.0" },
});
assert.equal(acknowledged.delivery, NUDGE_DELIVERY.untilAcknowledged);
assert.deepEqual(acknowledged.acknowledgementRef, {
  id: "ack.tool-result",
  version: "1.0.0",
});

const conditional = captureNudgeEffect({
  ...legacyEffect,
  delivery: NUDGE_DELIVERY.untilCondition,
  conditionRef: { id: "condition.turn-complete", version: "1.0.0" },
});
assert.equal(conditional.delivery, NUDGE_DELIVERY.untilCondition);
assert.deepEqual(conditional.conditionRef, {
  id: "condition.turn-complete",
  version: "1.0.0",
});

assert.throws(
  () => captureNudgeEffect({
    ...legacyEffect,
    delivery: NUDGE_DELIVERY.once,
    acknowledgementRef: { id: "ack.invalid", version: "1.0.0" },
  }),
  (error) => error instanceof NudgeProtocolValidationError &&
    error.failure === NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidDeliveryConfiguration,
);
assert.throws(
  () => captureNudgeEffect({
    ...legacyEffect,
    delivery: NUDGE_DELIVERY.untilAcknowledged,
  }),
  (error) => error instanceof NudgeProtocolValidationError &&
    error.failure === NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidDeliveryConfiguration,
);
assert.throws(
  () => captureNudgeEffect({
    ...legacyEffect,
    delivery: NUDGE_DELIVERY.untilCondition,
  }),
  (error) => error instanceof NudgeProtocolValidationError &&
    error.failure === NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidDeliveryConfiguration,
);
assert.throws(
  () => captureNudgeEffect({
    ...legacyEffect,
    delivery: NUDGE_DELIVERY.untilCondition,
    conditionRef: { id: "condition.invalid" },
  }),
  (error) => error instanceof NudgeProtocolValidationError &&
    error.failure === NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidConditionReference,
);
assert.throws(
  () => captureNudgeEffect({
    ...legacyEffect,
    delivery: "unsupported",
  }),
  (error) => error instanceof NudgeProtocolValidationError &&
    error.failure === NUDGE_PROTOCOL_VALIDATION_FAILURE.invalidDelivery,
);

console.log("runtime nudge protocol v2 smoke: passed");
