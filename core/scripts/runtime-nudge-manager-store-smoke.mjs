import assert from "node:assert/strict";
import {
  InMemoryPendingNudgeStore,
  NUDGE_LEASE_RELEASE_OUTCOME,
  NUDGE_MANAGER_FAILURE,
  NUDGE_SCHEDULE_OUTCOME,
  NudgeManager,
  NudgeManagerError,
  NudgeRenderer,
  NudgeSelector,
  NudgeTemplateRegistry,
  PENDING_NUDGE_STATE,
} from "../dist/index.js";

const logs = [];
const logger = {
  debug: (event, fields) => logs.push({ level: "debug", event, fields }),
  info: (event, fields) => logs.push({ level: "info", event, fields }),
  warn: (event, fields) => logs.push({ level: "warn", event, fields }),
  error: (event, fields) => logs.push({ level: "error", event, fields }),
  child: () => logger,
};

function effect(overrides = {}) {
  return {
    kind: "nudge",
    policyId: "policy.progress",
    templateId: "runtime.progress",
    templateVersion: "1",
    priority: 20,
    dedupeKey: "progress",
    targetRunId: "run-1",
    parameters: { privateValue: "SENSITIVE_NUDGE_PARAMETER" },
    cooldownTurns: 1,
    ...overrides,
  };
}

function createManager(store, templates = createTemplates()) {
  return new NudgeManager({
    store,
    selector: new NudgeSelector({ logger }),
    renderer: new NudgeRenderer({ templates, logger }),
    leaseIdFactory: {
      create: (request) => `lease:${request.providerCallId}`,
    },
    logger,
  });
}

function createTemplates() {
  const templates = new NudgeTemplateRegistry({ logger });
  templates.register({
    templateId: "runtime.progress",
    templateVersion: "1",
    render: (parameters) => `SENSITIVE_RENDERED_REMINDER:${parameters.privateValue}`,
  });
  templates.register({
    templateId: "runtime.secondary",
    templateVersion: "1",
    render: () => "secondary reminder",
  });
  return templates;
}

const store = new InMemoryPendingNudgeStore({ logger });
const manager = createManager(store);
const firstSchedule = await manager.schedule({
  nudgeId: "nudge-1",
  effect: effect(),
  scheduledSequence: 10,
  scheduledAt: "2026-08-01T09:00:00.000Z",
});
assert.equal(firstSchedule.outcome, NUDGE_SCHEDULE_OUTCOME.scheduled);

const unchangedSchedule = await manager.schedule({
  nudgeId: "nudge-1",
  effect: effect(),
  scheduledSequence: 10,
  scheduledAt: "2026-08-01T09:00:00.000Z",
});
assert.equal(unchangedSchedule.outcome, NUDGE_SCHEDULE_OUTCOME.unchanged);

const deduplicatedSchedule = await manager.schedule({
  nudgeId: "nudge-duplicate",
  effect: effect(),
  scheduledSequence: 11,
  scheduledAt: "2026-08-01T09:00:01.000Z",
});
assert.equal(deduplicatedSchedule.outcome, NUDGE_SCHEDULE_OUTCOME.deduplicated);
assert.equal(deduplicatedSchedule.nudge.id, "nudge-1");

await manager.schedule({
  nudgeId: "nudge-2",
  effect: effect({
    templateId: "runtime.secondary",
    dedupeKey: "secondary",
    priority: 10,
    cooldownTurns: undefined,
  }),
  scheduledSequence: 12,
  scheduledAt: "2026-08-01T09:00:02.000Z",
});

const leaseRequest = {
  providerCallId: "provider-call-1",
  targetRunId: "run-1",
  targetTurnNumber: 5,
  requestedLimit: 2,
  requestedAt: "2026-08-01T09:01:00.000Z",
};
const leased = await manager.leaseForProviderCall(leaseRequest);
assert.ok(leased);
assert.deepEqual(leased.overlay.nudgeIds, ["nudge-1", "nudge-2"]);
assert.equal(leased.lease.leaseId, "lease:provider-call-1");

const repeatedLease = await manager.leaseForProviderCall(leaseRequest);
assert.ok(repeatedLease);
assert.equal(repeatedLease.lease.leaseId, leased.lease.leaseId);
assert.deepEqual(repeatedLease.overlay, leased.overlay);

const activeSnapshot = await manager.snapshot();
assert.deepEqual(activeSnapshot.leases.map((lease) => lease.leaseId), [
  "lease:provider-call-1",
]);
assert.equal(
  activeSnapshot.nudges.every((nudge) => nudge.state === PENDING_NUDGE_STATE.leased),
  true,
);
const restoredActiveStore = new InMemoryPendingNudgeStore({ logger });
const restoredActiveManager = createManager(restoredActiveStore);
await restoredActiveManager.restore(activeSnapshot);
assert.equal(
  (await restoredActiveStore.list()).every(
    (nudge) => nudge.state === PENDING_NUDGE_STATE.scheduled,
  ),
  true,
);

const released = await manager.releaseLease(
  "provider-call-1",
  "2026-08-01T09:01:01.000Z",
);
assert.equal(released.outcome, NUDGE_LEASE_RELEASE_OUTCOME.released);
const releasedAgain = await manager.releaseLease(
  "provider-call-1",
  "2026-08-01T09:01:02.000Z",
);
assert.equal(releasedAgain.outcome, NUDGE_LEASE_RELEASE_OUTCOME.alreadyReleased);
assert.equal(
  (await store.list()).every(
    (nudge) => nudge.state === PENDING_NUDGE_STATE.scheduled,
  ),
  true,
);

const consumedLease = await manager.leaseForProviderCall({
  ...leaseRequest,
  providerCallId: "provider-call-2",
  requestedAt: "2026-08-01T09:02:00.000Z",
});
assert.ok(consumedLease);
const consumed = await manager.confirmDelivered(
  "provider-call-2",
  "2026-08-01T09:02:01.000Z",
);
assert.equal(consumed.unchanged, false);
assert.equal(
  consumed.nudges.every((nudge) => nudge.state === PENDING_NUDGE_STATE.consumed),
  true,
);
const consumedAgain = await manager.confirmDelivered(
  "provider-call-2",
  "2026-08-01T09:02:02.000Z",
);
assert.equal(consumedAgain.unchanged, true);
const scheduleAfterConsumption = await manager.schedule({
  nudgeId: "nudge-1",
  effect: effect(),
  scheduledSequence: 10,
  scheduledAt: "2026-08-01T09:00:00.000Z",
});
assert.equal(scheduleAfterConsumption.outcome, NUDGE_SCHEDULE_OUTCOME.unchanged);
assert.equal(scheduleAfterConsumption.nudge.state, PENDING_NUDGE_STATE.consumed);
const releaseConsumed = await manager.releaseLease(
  "provider-call-2",
  "2026-08-01T09:02:03.000Z",
);
assert.equal(
  releaseConsumed.outcome,
  NUDGE_LEASE_RELEASE_OUTCOME.alreadyConsumed,
);

await manager.schedule({
  nudgeId: "nudge-cooldown",
  effect: effect(),
  scheduledSequence: 13,
  scheduledAt: "2026-08-01T09:03:00.000Z",
});
assert.equal(
  await manager.leaseForProviderCall({
    providerCallId: "provider-call-cooldown-6",
    targetRunId: "run-1",
    targetTurnNumber: 6,
    requestedAt: "2026-08-01T09:03:01.000Z",
  }),
  undefined,
);
const afterCooldown = await manager.leaseForProviderCall({
  providerCallId: "provider-call-cooldown-7",
  targetRunId: "run-1",
  targetTurnNumber: 7,
  requestedAt: "2026-08-01T09:03:02.000Z",
});
assert.ok(afterCooldown);
await manager.releaseLease(
  "provider-call-cooldown-7",
  "2026-08-01T09:03:03.000Z",
);

await manager.schedule({
  nudgeId: "nudge-expire",
  effect: effect({
    dedupeKey: "expire",
    cooldownTurns: undefined,
    expiresAfterTurn: 7,
  }),
  scheduledSequence: 14,
  scheduledAt: "2026-08-01T09:04:00.000Z",
});
const expired = await manager.expire({
  targetRunId: "run-1",
  currentTurnNumber: 8,
  evaluatedAt: "2026-08-01T09:04:01.000Z",
});
assert.deepEqual(expired.map((nudge) => nudge.id), ["nudge-expire"]);
assert.deepEqual(
  await manager.expire({
    targetRunId: "run-1",
    currentTurnNumber: 8,
    evaluatedAt: "2026-08-01T09:04:02.000Z",
  }),
  [],
);

const consumedSnapshot = await manager.snapshot();
assert.equal(consumedSnapshot.leases.length, 0);
const restoredConsumedStore = new InMemoryPendingNudgeStore({ logger });
const restoredConsumedManager = createManager(restoredConsumedStore);
await restoredConsumedManager.restore(consumedSnapshot);
const restoredConfirmation = await restoredConsumedManager.confirmDelivered(
  "provider-call-2",
  "2026-08-01T09:05:00.000Z",
);
assert.equal(restoredConfirmation.unchanged, true);
assert.deepEqual(await restoredConsumedStore.listCooldowns(), [
  {
    targetRunId: "run-1",
    policyId: "policy.progress",
    dedupeKey: "progress",
    consumedTurnNumber: 5,
  },
]);

const badTemplates = createTemplates();
badTemplates.register({
  templateId: "runtime.failure",
  templateVersion: "1",
  render: () => {
    throw new Error("SENSITIVE_RENDER_FAILURE");
  },
});
const failedStore = new InMemoryPendingNudgeStore({ logger });
const failedManager = createManager(failedStore, badTemplates);
await failedManager.schedule({
  nudgeId: "nudge-render-failure",
  effect: effect({
    templateId: "runtime.failure",
    dedupeKey: "render-failure",
    cooldownTurns: undefined,
  }),
  scheduledSequence: 20,
  scheduledAt: "2026-08-01T09:10:00.000Z",
});
await assert.rejects(
  () =>
    failedManager.leaseForProviderCall({
      providerCallId: "provider-call-render-failure",
      targetRunId: "run-1",
      targetTurnNumber: 1,
      requestedAt: "2026-08-01T09:10:01.000Z",
    }),
  (error) =>
    error instanceof NudgeManagerError &&
    error.failure === NUDGE_MANAGER_FAILURE.renderFailed,
);
assert.equal(
  (await failedStore.list())[0].state,
  PENDING_NUDGE_STATE.scheduled,
);

const serializedLogs = JSON.stringify(logs);
for (const sensitive of [
  "SENSITIVE_NUDGE_PARAMETER",
  "SENSITIVE_RENDERED_REMINDER",
  "SENSITIVE_RENDER_FAILURE",
]) {
  assert.equal(serializedLogs.includes(sensitive), false);
}
assert.equal(
  logs.some((record) => record.event === "runtime.nudge.store_restored"),
  true,
);
assert.equal(
  logs.some(
    (record) => record.event === "runtime.nudge.lease_released_before_dispatch",
  ),
  true,
);
