import assert from "node:assert/strict";
import {
  InMemoryNudgeProviderCallReceiptStore,
  InMemoryPendingNudgeStore,
  NudgeManager,
  NudgeProviderCallCoordinator,
  NudgeRenderer,
  NudgeSelector,
  NudgeTemplateRegistry,
  PENDING_NUDGE_STATE,
} from "../dist/index.js";

const templates = new NudgeTemplateRegistry();
templates.register({
  templateId: "receipt.template",
  templateVersion: "1",
  render: () => "private reminder text",
});
const pendingStore = new InMemoryPendingNudgeStore();
const manager = new NudgeManager({
  store: pendingStore,
  selector: new NudgeSelector(),
  renderer: new NudgeRenderer({ templates }),
  leaseIdFactory: { create: () => "lease:receipt" },
});
const receiptStore = new InMemoryNudgeProviderCallReceiptStore();
const publicEvents = [];
const coordinator = new NudgeProviderCallCoordinator({
  manager,
  receiptStore,
  privateStateCommitter: { commit: async () => undefined },
  eventSink: {
    append: async (event) => {
      publicEvents.push(event.getSnapshot());
      return {
        status: "recorded",
        conversationId: event.conversationId,
        eventId: event.id,
        sequence: publicEvents.length,
        recordedAt: event.timestamp,
      };
    },
  },
  eventIdFactory: {
    create: ({ providerCallId, nudgeId, eventType }) =>
      `event:${providerCallId}:${nudgeId}:${eventType}`,
  },
});

await manager.schedule({
  nudgeId: "receipt-nudge",
  effect: {
    kind: "nudge",
    policyId: "receipt.policy",
    templateId: "receipt.template",
    templateVersion: "1",
    priority: 10,
    dedupeKey: "receipt",
    targetRunId: "run-receipt",
    parameters: { privateValue: "must-not-escape" },
  },
  scheduledSequence: 1,
  scheduledAt: "2026-08-03T00:00:00.000Z",
});

const prepared = await coordinator.prepare({
  conversationId: "conversation-receipt",
  runId: "run-receipt",
  providerCallId: "provider-receipt",
  requestedAt: "2026-08-03T00:00:01.000Z",
});
assert.ok(prepared);
assert.equal(prepared.overlay.nudgeIds[0], "receipt-nudge");

const first = await coordinator.confirmDispatched(
  prepared,
  "2026-08-03T00:00:02.000Z",
);
assert.equal(first.confirmation.unchanged, false);
assert.equal(first.receipt.applicationStatus, "applied");
assert.equal(first.receipt.deliveryIdentity, "provider-receipt::lease:receipt");
assert.deepEqual(first.receipt.nudgeIds, ["receipt-nudge"]);
assert.deepEqual(first.receipt.nudgeStates, [
  { nudgeId: "receipt-nudge", state: PENDING_NUDGE_STATE.consumed },
]);
assert.equal(first.eventReceipts.length, 1);

const duplicate = await coordinator.confirmDispatched(
  prepared,
  "2026-08-03T00:00:03.000Z",
);
assert.equal(duplicate.confirmation.unchanged, true);
assert.deepEqual(duplicate.receipt, first.receipt);
assert.equal(duplicate.eventReceipts.length, 0);
assert.equal(publicEvents.length, 1);

const restoredReceipt = await receiptStore.getByProviderCallId("provider-receipt");
assert.deepEqual(restoredReceipt, first.receipt);
assert.equal(JSON.stringify(first.receipt).includes("private reminder text"), false);
assert.equal(JSON.stringify(first.receipt).includes("must-not-escape"), false);

const persistentPendingStore = new InMemoryPendingNudgeStore();
const persistentManager = new NudgeManager({
  store: persistentPendingStore,
  selector: new NudgeSelector(),
  renderer: new NudgeRenderer({ templates }),
  leaseIdFactory: { create: () => "lease:persistent" },
});
const persistentCoordinator = new NudgeProviderCallCoordinator({
  manager: persistentManager,
  privateStateCommitter: { commit: async () => undefined },
  eventSink: { append: async (event) => ({
    status: "recorded",
    conversationId: event.conversationId,
    eventId: event.id,
    sequence: 1,
    recordedAt: event.timestamp,
  }) },
  eventIdFactory: { create: () => "persistent-event" },
});
await persistentManager.schedule({
  nudgeId: "persistent-nudge",
  effect: {
    kind: "nudge",
    policyId: "receipt.policy",
    templateId: "receipt.template",
    templateVersion: "1",
    delivery: "until_acknowledged",
    acknowledgementRef: { id: "ack.persistent", version: "1" },
    priority: 10,
    dedupeKey: "persistent",
    targetRunId: "run-persistent",
    parameters: {},
  },
  scheduledSequence: 1,
  scheduledAt: "2026-08-03T00:00:00.000Z",
});
const persistentPrepared = await persistentCoordinator.prepare({
  conversationId: "conversation-persistent",
  runId: "run-persistent",
  providerCallId: "provider-persistent",
  requestedAt: "2026-08-03T00:00:01.000Z",
});
assert.ok(persistentPrepared);
const persistentResult = await persistentCoordinator.confirmDispatched(
  persistentPrepared,
  "2026-08-03T00:00:02.000Z",
);
assert.deepEqual(persistentResult.receipt.nudgeStates, [
  { nudgeId: "persistent-nudge", state: PENDING_NUDGE_STATE.active },
]);

const postDispatchFailureStore = new InMemoryPendingNudgeStore();
const postDispatchFailureManager = new NudgeManager({
  store: postDispatchFailureStore,
  selector: new NudgeSelector(),
  renderer: new NudgeRenderer({ templates }),
  leaseIdFactory: { create: () => "lease:post-failure" },
});
const postDispatchFailureReceipts = new InMemoryNudgeProviderCallReceiptStore();
const postDispatchFailureCoordinator = new NudgeProviderCallCoordinator({
  manager: postDispatchFailureManager,
  receiptStore: postDispatchFailureReceipts,
  privateStateCommitter: { commit: async () => undefined },
  eventSink: { append: async () => { throw new Error("post-dispatch failure"); } },
  eventIdFactory: { create: () => "post-failure-event" },
});
await postDispatchFailureManager.schedule({
  nudgeId: "post-failure-nudge",
  effect: {
    kind: "nudge",
    policyId: "receipt.policy",
    templateId: "receipt.template",
    templateVersion: "1",
    priority: 10,
    dedupeKey: "post-failure",
    targetRunId: "run-post-failure",
    parameters: {},
  },
  scheduledSequence: 1,
  scheduledAt: "2026-08-03T00:00:00.000Z",
});
const postDispatchFailurePrepared = await postDispatchFailureCoordinator.prepare({
  conversationId: "conversation-post-failure",
  runId: "run-post-failure",
  providerCallId: "provider-post-failure",
  requestedAt: "2026-08-03T00:00:01.000Z",
});
assert.ok(postDispatchFailurePrepared);
await assert.rejects(() => postDispatchFailureCoordinator.confirmDispatched(
  postDispatchFailurePrepared,
  "2026-08-03T00:00:02.000Z",
));
assert.ok(
  await postDispatchFailureReceipts.getByProviderCallId("provider-post-failure"),
);
assert.equal(
  (await postDispatchFailureStore.list())[0].state,
  PENDING_NUDGE_STATE.consumed,
);

const preDispatchStore = new InMemoryPendingNudgeStore();
const preDispatchManager = new NudgeManager({
  store: preDispatchStore,
  selector: new NudgeSelector(),
  renderer: new NudgeRenderer({ templates }),
  leaseIdFactory: { create: () => "lease:released" },
});
const preDispatchReceipts = new InMemoryNudgeProviderCallReceiptStore();
const preDispatchCoordinator = new NudgeProviderCallCoordinator({
  manager: preDispatchManager,
  receiptStore: preDispatchReceipts,
  privateStateCommitter: { commit: async () => undefined },
  eventSink: { append: async () => { throw new Error("not reached"); } },
  eventIdFactory: { create: () => "not-reached" },
});
await preDispatchManager.schedule({
  nudgeId: "released-nudge",
  effect: {
    kind: "nudge",
    policyId: "receipt.policy",
    templateId: "receipt.template",
    templateVersion: "1",
    priority: 10,
    dedupeKey: "released",
    targetRunId: "run-released",
    parameters: {},
  },
  scheduledSequence: 2,
  scheduledAt: "2026-08-03T00:00:00.000Z",
});
const released = await preDispatchCoordinator.prepare({
  conversationId: "conversation-released",
  runId: "run-released",
  providerCallId: "provider-released",
  requestedAt: "2026-08-03T00:00:01.000Z",
});
assert.ok(released);
await preDispatchCoordinator.releaseBeforeDispatch(
  released,
  "2026-08-03T00:00:02.000Z",
);
assert.equal(
  await preDispatchReceipts.getByProviderCallId("provider-released"),
  undefined,
);
assert.equal((await preDispatchStore.list())[0].state, PENDING_NUDGE_STATE.scheduled);

console.log("runtime nudge provider-call receipt smoke: passed");
