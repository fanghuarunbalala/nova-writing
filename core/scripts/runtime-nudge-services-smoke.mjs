import assert from "node:assert/strict";
import {
  InMemoryPendingNudgeStore,
  NUDGE_ACKNOWLEDGEMENT_FAILURE,
  NUDGE_ACKNOWLEDGEMENT_SOURCE,
  NUDGE_CONDITION_FAILURE,
  NUDGE_DELIVERY,
  NudgeAcknowledgementCoordinator,
  NudgeAcknowledgementError,
  NudgeConditionCoordinator,
  NudgeConditionError,
  PENDING_NUDGE_STATE,
} from "../dist/index.js";

function persistentNudge(id, sequence, delivery, referenceKey) {
  return {
    id,
    policyId: "policy.services",
    templateId: "template.services",
    templateVersion: "1.0.0",
    priority: 10,
    dedupeKey: id,
    parameters: { id },
    exclusive: false,
    placement: "system-prompt-overlay",
    delivery,
    ...(delivery === NUDGE_DELIVERY.untilAcknowledged
      ? { acknowledgementRef: { id: referenceKey, version: "1.0.0" } }
      : { conditionRef: { id: referenceKey, version: "1.0.0" } }),
    state: PENDING_NUDGE_STATE.scheduled,
    targetRunId: "run-services",
    scheduledSequence: sequence,
    scheduledAt: "2026-08-03T00:00:00.000Z",
  };
}

async function activate(store, value, providerCallId, turn) {
  await store.schedule(value);
  await store.lease({
    leaseId: `lease:${providerCallId}`,
    providerCallId,
    targetRunId: "run-services",
    targetTurnNumber: turn,
    nudgeIds: [value.id],
    leasedAt: `2026-08-03T00:0${turn}:00.000Z`,
  });
  const result = await store.confirmDispatched({
    providerCallId,
    dispatchedAt: `2026-08-03T00:0${turn}:01.000Z`,
  });
  assert.equal(result.nudges[0].state, PENDING_NUDGE_STATE.active);
}

const store = new InMemoryPendingNudgeStore();
await activate(
  store,
  persistentNudge(
    "nudge-ack-service",
    1,
    NUDGE_DELIVERY.untilAcknowledged,
    "ack.services",
  ),
  "provider-ack-service",
  1,
);
const acknowledgement = new NudgeAcknowledgementCoordinator({ store });
const acknowledged = await acknowledgement.acknowledge({
  nudgeId: "nudge-ack-service",
  targetRunId: "run-services",
  acknowledgementRef: { id: "ack.services", version: "1.0.0" },
  source: NUDGE_ACKNOWLEDGEMENT_SOURCE.toolResult,
  reasonId: "tool.result.completed",
  acknowledgedAt: "2026-08-03T00:01:02.000Z",
});
assert.equal(acknowledged.nudge.state, PENDING_NUDGE_STATE.acknowledged);
assert.equal(acknowledged.source, NUDGE_ACKNOWLEDGEMENT_SOURCE.toolResult);
assert.equal(acknowledged.reasonId, "tool.result.completed");

await assert.rejects(
  () => acknowledgement.acknowledge({
    nudgeId: "nudge-ack-service",
    targetRunId: "run-services",
    acknowledgementRef: { id: "ack.services", version: "1.0.0" },
    source: "assistant_text",
    acknowledgedAt: "2026-08-03T00:01:03.000Z",
  }),
  (error) => error instanceof NudgeAcknowledgementError &&
    error.failure === NUDGE_ACKNOWLEDGEMENT_FAILURE.unsupportedSource,
);

await activate(
  store,
  persistentNudge(
    "nudge-condition-service",
    2,
    NUDGE_DELIVERY.untilCondition,
    "condition.services",
  ),
  "provider-condition-service",
  2,
);
const falseCondition = new NudgeConditionCoordinator({
  store,
  timeoutMs: 100,
  evaluator: { async evaluate() { return { matched: false }; } },
});
assert.deepEqual(
  await falseCondition.resolve({
    nudgeId: "nudge-condition-service",
    targetRunId: "run-services",
    conditionRef: { id: "condition.services", version: "1.0.0" },
    evaluatedAt: "2026-08-03T00:02:02.000Z",
  }),
  { status: "not_matched" },
);
assert.equal(
  (await store.listActive("run-services")).some((item) => item.id === "nudge-condition-service"),
  true,
);

const trueCondition = new NudgeConditionCoordinator({
  store,
  timeoutMs: 100,
  evaluator: { async evaluate() { return { matched: true }; } },
});
const resolved = await trueCondition.resolve({
  nudgeId: "nudge-condition-service",
  targetRunId: "run-services",
  conditionRef: { id: "condition.services", version: "1.0.0" },
  evaluatedAt: "2026-08-03T00:02:03.000Z",
});
assert.equal(resolved.status, "resolved");
assert.equal(resolved.nudge.state, PENDING_NUDGE_STATE.resolved);

const failedCondition = new NudgeConditionCoordinator({
  store,
  timeoutMs: 100,
  evaluator: { async evaluate() { throw new Error("private evaluator failure"); } },
});
await assert.rejects(
  () => failedCondition.resolve({
    nudgeId: "nudge-condition-service",
    targetRunId: "run-services",
    conditionRef: { id: "condition.services", version: "1.0.0" },
    evaluatedAt: "2026-08-03T00:02:04.000Z",
  }),
  (error) => error instanceof NudgeConditionError &&
    error.failure === NUDGE_CONDITION_FAILURE.evaluationFailed,
);

const timeoutCondition = new NudgeConditionCoordinator({
  store,
  timeoutMs: 10,
  evaluator: { async evaluate() { return new Promise(() => {}); } },
});
await assert.rejects(
  () => timeoutCondition.resolve({
    nudgeId: "nudge-condition-service",
    targetRunId: "run-services",
    conditionRef: { id: "condition.services", version: "1.0.0" },
    evaluatedAt: "2026-08-03T00:02:05.000Z",
  }),
  (error) => error instanceof NudgeConditionError &&
    error.failure === NUDGE_CONDITION_FAILURE.evaluationTimeout,
);

console.log("runtime nudge services smoke: passed");
