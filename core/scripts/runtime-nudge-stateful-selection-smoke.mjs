import assert from "node:assert/strict";
import {
  InMemoryPendingNudgeStore,
  NUDGE_DELIVERY,
  NudgeSelector,
  PENDING_NUDGE_STATE,
  capturePendingNudge,
} from "../dist/index.js";

function candidate({
  id,
  sequence,
  state = PENDING_NUDGE_STATE.scheduled,
  delivery = NUDGE_DELIVERY.once,
  dedupeKey = id,
  priority = 10,
  targetTurnNumber,
  exclusive = false,
}) {
  return capturePendingNudge({
    id,
    policyId: "policy.selection",
    templateId: "template.selection",
    templateVersion: "1.0.0",
    priority,
    dedupeKey,
    parameters: { id },
    exclusive,
    placement: "system-prompt-overlay",
    delivery,
    ...(delivery === NUDGE_DELIVERY.untilAcknowledged
      ? { acknowledgementRef: { id: `ack.${id}`, version: "1.0.0" } }
      : delivery === NUDGE_DELIVERY.untilCondition
      ? { conditionRef: { id: `condition.${id}`, version: "1.0.0" } }
      : {}),
    state,
    targetRunId: "run-selection",
    ...(targetTurnNumber === undefined ? {} : { targetTurnNumber }),
    scheduledSequence: sequence,
    scheduledAt: "2026-08-03T00:00:00.000Z",
  });
}

const active = candidate({
  id: "active-progress",
  sequence: 1,
  state: PENDING_NUDGE_STATE.active,
  delivery: NUDGE_DELIVERY.untilCondition,
  dedupeKey: "progress",
  priority: 1,
  targetTurnNumber: 1,
});
const duplicateScheduled = candidate({
  id: "scheduled-progress",
  sequence: 2,
  dedupeKey: "progress",
  priority: 100,
});
const independent = candidate({
  id: "independent",
  sequence: 3,
  priority: 5,
});
const selector = new NudgeSelector();
const request = {
  providerCallId: "provider-selection",
  targetRunId: "run-selection",
  targetTurnNumber: 4,
  requestedLimit: 2,
  requestedAt: "2026-08-03T00:04:00.000Z",
};
const before = JSON.stringify([active, duplicateScheduled, independent]);
const selected = selector.select([active, duplicateScheduled, independent], request);
assert.deepEqual(selected.map((item) => item.id), ["active-progress", "independent"]);
assert.equal(JSON.stringify([active, duplicateScheduled, independent]), before);

const exclusive = candidate({
  id: "exclusive",
  sequence: 4,
  priority: 200,
  exclusive: true,
});
assert.deepEqual(
  selector.select([exclusive, independent], request).map((item) => item.id),
  ["exclusive"],
);

const scheduledTarget = candidate({
  id: "scheduled-target",
  sequence: 5,
  targetTurnNumber: 6,
});
assert.deepEqual(
  selector.select([scheduledTarget], request),
  [],
);

const store = new InMemoryPendingNudgeStore();
await store.schedule(candidate({
  id: "store-active",
  sequence: 6,
  delivery: NUDGE_DELIVERY.untilAcknowledged,
  targetTurnNumber: 1,
}));
await store.lease({
  leaseId: "lease:store-active",
  providerCallId: "provider-store-active",
  targetRunId: "run-selection",
  targetTurnNumber: 1,
  nudgeIds: ["store-active"],
  leasedAt: "2026-08-03T00:01:00.000Z",
});
await store.confirmDispatched({
  providerCallId: "provider-store-active",
  dispatchedAt: "2026-08-03T00:01:01.000Z",
});
const activeStoreNudge = (await store.list())[0];
assert.equal(activeStoreNudge.state, PENDING_NUDGE_STATE.active);
await store.lease({
  leaseId: "lease:store-active-retry",
  providerCallId: "provider-store-active-retry",
  targetRunId: "run-selection",
  targetTurnNumber: 4,
  nudgeIds: ["store-active"],
  leasedAt: "2026-08-03T00:04:01.000Z",
});
assert.equal((await store.list())[0].state, PENDING_NUDGE_STATE.leased);
await store.releaseBeforeDispatch({
  providerCallId: "provider-store-active-retry",
  releasedAt: "2026-08-03T00:04:02.000Z",
});
assert.equal((await store.list())[0].state, PENDING_NUDGE_STATE.active);

console.log("runtime nudge stateful selection smoke: passed");
