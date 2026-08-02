import assert from "node:assert/strict";
import {
  CONTEXT_COMPACTION_MANAGER_DISPOSITION,
  CONTEXT_COMPACTION_OUTCOME,
  ContextCheckpointApplicationCoordinator,
  ContextCompactionLifecycleCoordinator,
  ContextCompactionStartedOutputEvent,
  ContextCompactionCompletedOutputEvent,
  ContextCompactionFailedOutputEvent,
  ContextCheckpointAppliedOutputEvent,
  OUTPUT_EVENT_TYPE,
  createCoreEventSchemaRegistry,
} from "../dist/index.js";

const registry = createCoreEventSchemaRegistry();
const privateMarker = "PRIVATE_COMPACTION_EVENT_CONTENT";
const events = [];
const sink = { async append(event) { const snapshot = event.getSnapshot(); registry.validateOutput(snapshot); if (!events.some((item) => item.id === snapshot.id)) events.push(snapshot); return { status: "recorded", conversationId: snapshot.conversationId, eventId: snapshot.id, sequence: events.length, recordedAt: snapshot.timestamp }; } };
const idFactory = { create: ({ eventType, providerCallId, checkpointId }) => `event:${eventType}:${providerCallId}${checkpointId ? `:${checkpointId}` : ""}` };
const effect = {
  kind: "context_compaction", policyId: "context_pressure", trigger: "hard_admission_risk",
  conversationId: "conversation-1", runId: "run-1", providerCallId: "provider-1", requestedAt: "2026-08-02T06:00:00.000Z",
  pressure: { estimate: { totalInputTokens: 95 }, irreducibleFloor: { totalTokens: 30 } },
  targetTokens: 55, hardAdmissionTokens: 92,
};
const assessment = { outcome: CONTEXT_COMPACTION_OUTCOME.reduced, tokenEstimateBefore: 95, tokenEstimateAfter: 70, completedAt: "2026-08-02T06:00:01.000Z" };
const checkpoint = { id: "checkpoint-1", sourceStartSequence: 1, sourceEndSequence: 20 };
const lifecycle = new ContextCompactionLifecycleCoordinator({ manager: { compact: async () => ({ disposition: CONTEXT_COMPACTION_MANAGER_DISPOSITION.activated, attempt: {}, assessment, checkpoint }) }, eventSink: sink, eventIdFactory: idFactory, clock: { now: () => "2026-08-02T06:00:02.000Z" } });
await lifecycle.handle({ conversationId: "conversation-1" }, effect);
assert.deepEqual(events.map((event) => event.eventType), [OUTPUT_EVENT_TYPE.contextCompactionStarted, OUTPUT_EVENT_TYPE.contextCompactionCompleted]);
assert.equal(events[1].payload.checkpointId, "checkpoint-1");

const beforeDuplicate = events.length;
const duplicate = new ContextCompactionLifecycleCoordinator({ manager: { compact: async () => ({ disposition: CONTEXT_COMPACTION_MANAGER_DISPOSITION.duplicate, attempt: {} }) }, eventSink: sink, eventIdFactory: idFactory, clock: { now: () => "2026-08-02T06:00:02.000Z" } });
await duplicate.handle({}, effect);
assert.equal(events.length, beforeDuplicate);

const unreducible = new ContextCompactionLifecycleCoordinator({ manager: { compact: async () => ({ disposition: CONTEXT_COMPACTION_MANAGER_DISPOSITION.unreducible, attempt: {}, assessment: { ...assessment, outcome: CONTEXT_COMPACTION_OUTCOME.unreducible, unreducibleReason: "pinned_context_too_large" } }) }, eventSink: sink, eventIdFactory: { create: ({ eventType }) => `unreducible:${eventType}` }, clock: { now: () => "2026-08-02T06:00:03.000Z" } });
await unreducible.handle({}, { ...effect, providerCallId: "provider-2" });
assert.equal(events.at(-1).eventType, OUTPUT_EVENT_TYPE.contextCompactionFailed);
assert.equal(events.at(-1).payload.failure, "pinned_context_too_large");

const applications = new ContextCheckpointApplicationCoordinator({ eventSink: sink, eventIdFactory: idFactory });
await applications.confirmDispatched({ conversationId: "conversation-1", runId: "run-1", providerCallId: "provider-3", checkpointId: "checkpoint-1", dispatchedAt: "2026-08-02T06:00:04.000Z" });
await applications.confirmDispatched({ conversationId: "conversation-1", runId: "run-1", providerCallId: "provider-3", checkpointId: "checkpoint-1", dispatchedAt: "2026-08-02T06:00:04.000Z" });
assert.equal(events.filter((event) => event.eventType === OUTPUT_EVENT_TYPE.contextCheckpointApplied).length, 1);

for (const EventClass of [ContextCompactionStartedOutputEvent, ContextCompactionCompletedOutputEvent, ContextCompactionFailedOutputEvent, ContextCheckpointAppliedOutputEvent]) assert.equal(typeof EventClass, "function");
assert.equal(JSON.stringify(events).includes(privateMarker), false);
console.log("runtime context compaction events smoke passed");
