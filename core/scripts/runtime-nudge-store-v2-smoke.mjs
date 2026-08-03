import assert from "node:assert/strict";
import {
  InMemoryPendingNudgeStore,
  NUDGE_DELIVERY,
  NudgeProtocolValidationError,
  PENDING_NUDGE_STATE,
} from "../dist/index.js";

function nudge({
  id,
  sequence,
  delivery = NUDGE_DELIVERY.once,
  acknowledgementRef,
  conditionRef,
}) {
  return {
    id,
    policyId: "policy.store",
    templateId: "template.store",
    templateVersion: "1.0.0",
    priority: 10,
    dedupeKey: id,
    parameters: { id },
    exclusive: false,
    placement: "system-prompt-overlay",
    delivery,
    ...(acknowledgementRef === undefined ? {} : { acknowledgementRef }),
    ...(conditionRef === undefined ? {} : { conditionRef }),
    state: PENDING_NUDGE_STATE.scheduled,
    targetRunId: "run-store",
    scheduledSequence: sequence,
    scheduledAt: "2026-08-03T00:00:00.000Z",
  };
}

async function confirm(store, nudgeId, providerCallId, turn = 1) {
  await store.schedule(nudge({ id: nudgeId, sequence: turn }));
  await store.lease({
    leaseId: `lease:${providerCallId}`,
    providerCallId,
    targetRunId: "run-store",
    targetTurnNumber: turn,
    nudgeIds: [nudgeId],
    leasedAt: `2026-08-03T00:0${turn}:00.000Z`,
  });
  return store.confirmDispatched({
    providerCallId,
    dispatchedAt: `2026-08-03T00:0${turn}:01.000Z`,
  });
}

const store = new InMemoryPendingNudgeStore();
const onceResult = await confirm(store, "nudge-once", "provider-once");
assert.equal(onceResult.nudges[0].state, PENDING_NUDGE_STATE.consumed);
assert.equal(onceResult.consumptions.length, 1);

await store.schedule(nudge({
  id: "nudge-ack",
  sequence: 2,
  delivery: NUDGE_DELIVERY.untilAcknowledged,
  acknowledgementRef: { id: "ack.store", version: "1.0.0" },
}));
await store.lease({
  leaseId: "lease:provider-ack",
  providerCallId: "provider-ack",
  targetRunId: "run-store",
  targetTurnNumber: 2,
  nudgeIds: ["nudge-ack"],
  leasedAt: "2026-08-03T00:02:00.000Z",
});
const activeResult = await store.confirmDispatched({
  providerCallId: "provider-ack",
  dispatchedAt: "2026-08-03T00:02:01.000Z",
});
assert.equal(activeResult.nudges[0].state, PENDING_NUDGE_STATE.active);
assert.equal(activeResult.consumptions.length, 0);
assert.deepEqual(
  (await store.listActive("run-store")).map((item) => item.id),
  ["nudge-ack"],
);
const acknowledged = await store.acknowledge({
  nudgeId: "nudge-ack",
  targetRunId: "run-store",
  acknowledgementRef: { id: "ack.store", version: "1.0.0" },
  acknowledgedAt: "2026-08-03T00:02:02.000Z",
});
assert.equal(acknowledged.state, PENDING_NUDGE_STATE.acknowledged);
assert.deepEqual(
  await store.acknowledge({
    nudgeId: "nudge-ack",
    targetRunId: "run-store",
    acknowledgementRef: { id: "ack.store", version: "1.0.0" },
    acknowledgedAt: "2026-08-03T00:02:03.000Z",
  }),
  acknowledged,
);

await store.schedule(nudge({
  id: "nudge-condition",
  sequence: 3,
  delivery: NUDGE_DELIVERY.untilCondition,
  conditionRef: { id: "condition.store", version: "1.0.0" },
}));
await store.lease({
  leaseId: "lease:provider-condition",
  providerCallId: "provider-condition",
  targetRunId: "run-store",
  targetTurnNumber: 3,
  nudgeIds: ["nudge-condition"],
  leasedAt: "2026-08-03T00:03:00.000Z",
});
await store.confirmDispatched({
  providerCallId: "provider-condition",
  dispatchedAt: "2026-08-03T00:03:01.000Z",
});
const resolved = await store.resolveCondition({
  nudgeId: "nudge-condition",
  targetRunId: "run-store",
  conditionRef: { id: "condition.store", version: "1.0.0" },
  resolvedAt: "2026-08-03T00:03:02.000Z",
});
assert.equal(resolved.state, PENDING_NUDGE_STATE.resolved);

await store.schedule(nudge({ id: "nudge-scheduled", sequence: 4 }));
const superseded = await store.supersede({
  nudgeId: "nudge-scheduled",
  targetRunId: "run-store",
  supersededByNudgeId: "nudge-replacement",
  supersededAt: "2026-08-03T00:04:00.000Z",
});
assert.equal(superseded.state, PENDING_NUDGE_STATE.superseded);

await store.schedule(nudge({ id: "nudge-leased", sequence: 5 }));
await store.lease({
  leaseId: "lease:provider-reconcile",
  providerCallId: "provider-reconcile",
  targetRunId: "run-store",
  nudgeIds: ["nudge-leased"],
  leasedAt: "2026-08-03T00:05:00.000Z",
});
const reconciliation = await store.reconcileLeases();
assert.deepEqual(reconciliation.nudgeIds, ["nudge-leased"]);
assert.deepEqual(reconciliation.providerCallIds, ["provider-reconcile"]);
assert.equal(
  (await store.list()).find((item) => item.id === "nudge-leased").state,
  PENDING_NUDGE_STATE.scheduled,
);

const snapshot = await store.snapshot();
assert.equal(snapshot.schemaVersion, 2);
assert.ok(snapshot.deliveryAttempts.length >= 4);
const restored = new InMemoryPendingNudgeStore();
await restored.restore(snapshot);
assert.equal(
  (await restored.list()).find((item) => item.id === "nudge-ack").state,
  PENDING_NUDGE_STATE.acknowledged,
);
assert.equal(
  (await restored.list()).find((item) => item.id === "nudge-condition").state,
  PENDING_NUDGE_STATE.resolved,
);
assert.equal(
  (await restored.confirmDispatched({
    providerCallId: "provider-ack",
    dispatchedAt: "2026-08-03T00:06:01.000Z",
  })).unchanged,
  true,
);

const legacySnapshot = { ...snapshot, schemaVersion: 1 };
delete legacySnapshot.deliveryAttempts;
const legacyRestored = new InMemoryPendingNudgeStore();
await legacyRestored.restore(legacySnapshot);
assert.equal((await legacyRestored.list()).length, (await restored.list()).length);
assert.equal(
  (await restored.releaseBeforeDispatch({
    providerCallId: "provider-reconcile",
    releasedAt: "2026-08-03T00:06:02.000Z",
  })).outcome,
  "already_released",
);

await assert.rejects(
  () => restored.acknowledge({
    nudgeId: "nudge-condition",
    targetRunId: "run-store",
    acknowledgementRef: { id: "wrong", version: "1.0.0" },
    acknowledgedAt: "2026-08-03T00:06:00.000Z",
  }),
  (error) => error.name === "PendingNudgeStoreError" &&
    error.failure === "invalid_acknowledgement",
);

console.log("runtime nudge store v2 smoke: passed");
