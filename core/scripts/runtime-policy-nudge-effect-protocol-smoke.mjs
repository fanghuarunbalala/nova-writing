import assert from "node:assert/strict";
import {
  captureRuntimeNudgeLifecycleEffect,
  captureRuntimePolicyEffect,
} from "../dist/index.js";

const base = {
  policyId: "policy.nudge",
  conversationId: "conversation-policy",
  runId: "run-policy",
};

const schedule = captureRuntimeNudgeLifecycleEffect({
  ...base,
  kind: "nudge_schedule",
  nudgeId: "nudge-schedule",
  effect: {
    kind: "nudge",
    policyId: "policy.nudge",
    templateId: "template.nudge",
    templateVersion: "1",
    priority: 10,
    dedupeKey: "schedule",
    targetRunId: "run-policy",
    parameters: { private: "payload" },
  },
  scheduledSequence: 4,
  scheduledAt: "2026-08-03T00:00:00.000Z",
});
assert.equal(schedule.kind, "nudge_schedule");
assert.equal(Object.isFrozen(schedule), true);
assert.equal(Object.isFrozen(schedule.effect), true);

const acknowledge = captureRuntimePolicyEffect({
  ...base,
  kind: "nudge_acknowledge",
  nudgeId: "nudge-ack",
  acknowledgementRef: { id: "ack.policy", version: "1" },
  acknowledgedAt: "2026-08-03T00:00:01.000Z",
});
const resolve = captureRuntimePolicyEffect({
  ...base,
  kind: "nudge_resolve",
  nudgeId: "nudge-condition",
  conditionRef: { id: "condition.policy", version: "1" },
  resolvedAt: "2026-08-03T00:00:02.000Z",
});
const expire = captureRuntimePolicyEffect({
  ...base,
  kind: "nudge_expire",
  targetRunId: "run-policy",
  evaluatedAt: "2026-08-03T00:00:03.000Z",
  currentTurnNumber: 3,
  runEnded: false,
});
const supersede = captureRuntimePolicyEffect({
  ...base,
  kind: "nudge_supersede",
  nudgeId: "nudge-old",
  targetRunId: "run-policy",
  supersededByNudgeId: "nudge-new",
  supersededAt: "2026-08-03T00:00:04.000Z",
});
assert.deepEqual(
  [acknowledge.kind, resolve.kind, expire.kind, supersede.kind],
  ["nudge_acknowledge", "nudge_resolve", "nudge_expire", "nudge_supersede"],
);

assert.throws(() => captureRuntimePolicyEffect({
  ...base,
  kind: "nudge_schedule",
  nudgeId: "nudge-invalid",
  effect: {
    kind: "nudge",
    policyId: "policy.nudge",
    templateId: "template.nudge",
    templateVersion: "1",
    priority: 10,
    dedupeKey: "invalid",
    targetRunId: "different-run",
    parameters: {},
  },
  scheduledSequence: 1,
  scheduledAt: "2026-08-03T00:00:00.000Z",
}));
assert.throws(() => captureRuntimePolicyEffect({
  ...base,
  kind: "nudge_supersede",
  nudgeId: "same-id",
  targetRunId: "run-policy",
  supersededByNudgeId: "same-id",
  supersededAt: "2026-08-03T00:00:00.000Z",
}));

console.log("runtime policy nudge effect protocol smoke: passed");
