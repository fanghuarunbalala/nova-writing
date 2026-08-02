import assert from "node:assert/strict";
import {
  ARTIFACT_REFERENCE_SCHEMA_VERSION,
  DefaultChildConversationManager,
  DefaultSubagentLifecycleCoordinator,
  OUTPUT_EVENT_TYPE,
  SUBAGENT_CANCELLATION_REASON,
  SUBAGENT_LIFECYCLE_FAILURE,
  SUBAGENT_SCHEMA_VERSION,
  SUBAGENT_STATUS,
  SUBAGENT_TOOL_POLICY_RELATION,
  SubagentLifecycleCoordinatorError,
  createCoreEventSchemaRegistry,
} from "../dist/index.js";

const startedAt = "2026-08-02T09:00:00.000Z";
const completedAt = "2026-08-02T09:01:00.000Z";

class CapturingLogger {
  records = [];
  child() { return this; }
  debug(event, fields) { this.records.push({ event, fields }); }
  info(event, fields) { this.records.push({ event, fields }); }
  warn(event, fields) { this.records.push({ event, fields }); }
  error(event, fields) { this.records.push({ event, fields }); }
}

function request(subagentId) {
  return {
    schemaVersion: SUBAGENT_SCHEMA_VERSION,
    subagentId,
    parentConversationId: "conversation-parent",
    parentRunId: "run-parent",
    parentTurnId: "turn-parent",
    agentType: "explore",
    definitionVersion: "v1",
    objective: `private objective ${subagentId}`,
    toolPolicyId: "policy-child",
    requestedAt: startedAt,
  };
}

function result(binding, status, options = {}) {
  return {
    schemaVersion: SUBAGENT_SCHEMA_VERSION,
    subagentId: binding.subagentId,
    parentConversationId: binding.parentConversationId,
    parentRunId: binding.parentRunId,
    childConversationId: binding.childConversationId,
    status,
    ...(options.summary === undefined ? {} : { summary: options.summary }),
    artifactReferences: options.artifactReferences ?? [],
    ...(options.errorCode === undefined ? {} : { errorCode: options.errorCode }),
    ...(options.cancellationReason === undefined ? {} : { cancellationReason: options.cancellationReason }),
    completedAt,
  };
}

function createHarness() {
  const registry = createCoreEventSchemaRegistry();
  const events = [];
  const failEventTypes = new Set();
  const logger = new CapturingLogger();
  const manager = new DefaultChildConversationManager({
    parentScopeReader: {
      async readParentScope(input) {
        return { parentConversationId: input.parentConversationId, parentRunId: input.parentRunId, workspaceId: "workspace-main", depth: 0, toolPolicyId: "policy-parent" };
      },
    },
    toolPolicyRelationReader: { async readRelation() { return SUBAGENT_TOOL_POLICY_RELATION.reduced; } },
    creationPort: {
      async createChild(input) {
        return { childConversationId: `conversation-child-${input.subagentId}`, createdAt: startedAt };
      },
    },
    activationPort: { async activateChild() {} },
    rollbackPort: { async rollbackChild() {} },
    clock: { now: () => startedAt },
    logger,
  });
  const coordinator = new DefaultSubagentLifecycleCoordinator({
    manager,
    eventSink: {
      async append(event) {
        if (failEventTypes.has(event.getEventType())) throw new Error("private append error");
        const snapshot = event.getSnapshot();
        registry.validateOutput(snapshot);
        events.push(snapshot);
        return { status: "recorded", conversationId: snapshot.conversationId, eventId: snapshot.id, sequence: events.length, recordedAt: snapshot.timestamp };
      },
    },
    eventIdFactory: {
      create(input) { return `event-${input.subagentId}-${input.eventType}-${input.ordinal}`; },
    },
    clock: { now: () => completedAt },
    logger,
  });
  return { coordinator, manager, events, failEventTypes, logger };
}

async function expectFailure(promise, failure) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof SubagentLifecycleCoordinatorError, true);
    assert.equal(error.failure, failure);
    assert.equal(error.message, "Subagent lifecycle coordination failed");
    assert.equal("cause" in error, false);
    return true;
  });
}

const happy = createHarness();
const handle = await happy.coordinator.start(request("happy"));
assert.equal(handle.binding.status, SUBAGENT_STATUS.running);
assert.equal(happy.events[0].eventType, OUTPUT_EVENT_TYPE.subagentStarted);
assert.deepEqual(happy.events[0].payload, {
  subagentId: "happy",
  childConversationId: "conversation-child-happy",
  agentType: "explore",
  definitionVersion: "v1",
  startedAt,
});
await happy.coordinator.reportProgress({ subagentId: "happy", progressCode: "source.scan" });
await happy.coordinator.reportProgress({ subagentId: "happy", progressCode: "evidence.ready", reportedAt: completedAt });
assert.deepEqual(happy.events.slice(1).map((event) => [event.eventType, event.payload.ordinal]), [
  [OUTPUT_EVENT_TYPE.subagentProgress, 1],
  [OUTPUT_EVENT_TYPE.subagentProgress, 2],
]);

let resultReleased = false;
void handle.result.then(() => { resultReleased = true; });
const completed = result(handle.binding, "completed", { summary: "bounded parent summary" });
assert.deepEqual(await happy.coordinator.deliverResult(completed), completed);
assert.deepEqual(await handle.result, completed);
assert.equal(resultReleased, true);
assert.equal(happy.events.at(-1).eventType, OUTPUT_EVENT_TYPE.subagentCompleted);
assert.equal(happy.manager.getBinding("happy").status, SUBAGENT_STATUS.completed);
assert.equal(happy.manager.getCapacity("conversation-parent", "run-parent").activeGlobal, 0);
assert.deepEqual(await happy.coordinator.deliverResult(completed), completed);
await expectFailure(
  happy.coordinator.deliverResult({ ...completed, summary: "conflicting summary" }),
  SUBAGENT_LIFECYCLE_FAILURE.duplicateResultConflict,
);
await expectFailure(
  happy.coordinator.reportProgress({ subagentId: "happy", progressCode: "late.progress" }),
  SUBAGENT_LIFECYCLE_FAILURE.childNotRunning,
);

const artifactHarness = createHarness();
const artifactHandle = await artifactHarness.coordinator.start(request("artifact"));
const artifact = {
  schemaVersion: ARTIFACT_REFERENCE_SCHEMA_VERSION,
  artifactId: "artifact-result",
  conversationId: artifactHandle.binding.childConversationId,
  contentType: "application/json",
  byteLength: 128,
  digest: `sha256:${"a".repeat(64)}`,
};
await artifactHarness.coordinator.deliverResult(result(artifactHandle.binding, "completed", { artifactReferences: [artifact] }));
assert.deepEqual(artifactHarness.events.at(-1).payload.artifactReferences, [artifact]);

const terminalKinds = createHarness();
const failedHandle = await terminalKinds.coordinator.start(request("failed"));
await terminalKinds.coordinator.deliverResult(result(failedHandle.binding, "failed", { errorCode: "CHILD_EXECUTION_FAILED" }));
assert.equal(terminalKinds.events.at(-1).eventType, OUTPUT_EVENT_TYPE.subagentFailed);
assert.equal(terminalKinds.events.at(-1).payload.outcome, "failed");
const cancelledHandle = await terminalKinds.coordinator.start(request("cancelled"));
await terminalKinds.coordinator.deliverResult(result(cancelledHandle.binding, "cancelled", { cancellationReason: SUBAGENT_CANCELLATION_REASON.parentStopped }));
assert.equal(terminalKinds.events.at(-1).eventType, OUTPUT_EVENT_TYPE.subagentCancelled);
const orphanedHandle = await terminalKinds.coordinator.start(request("orphaned"));
await terminalKinds.coordinator.deliverResult(result(orphanedHandle.binding, "orphaned", { cancellationReason: SUBAGENT_CANCELLATION_REASON.orphanReclaimed }));
assert.equal(terminalKinds.events.at(-1).eventType, OUTPUT_EVENT_TYPE.subagentFailed);
assert.equal(terminalKinds.events.at(-1).payload.outcome, "orphaned");

const startFailure = createHarness();
startFailure.failEventTypes.add(OUTPUT_EVENT_TYPE.subagentStarted);
await expectFailure(startFailure.coordinator.start(request("start-fails")), SUBAGENT_LIFECYCLE_FAILURE.startedProjectionFailed);
assert.equal(startFailure.manager.getBinding("start-fails").status, SUBAGENT_STATUS.running);

const terminalFailure = createHarness();
const terminalFailureHandle = await terminalFailure.coordinator.start(request("terminal-fails"));
terminalFailure.failEventTypes.add(OUTPUT_EVENT_TYPE.subagentCompleted);
await expectFailure(
  terminalFailure.coordinator.deliverResult(result(terminalFailureHandle.binding, "completed", { summary: "private result summary" })),
  SUBAGENT_LIFECYCLE_FAILURE.terminalProjectionFailed,
);
assert.equal(terminalFailure.manager.getBinding("terminal-fails").status, SUBAGENT_STATUS.running);

await expectFailure(happy.coordinator.waitForResult("missing"), SUBAGENT_LIFECYCLE_FAILURE.unknownSubagent);
await expectFailure(happy.coordinator.reportProgress({ subagentId: "happy", progressCode: "INVALID" }), SUBAGENT_LIFECYCLE_FAILURE.invalidProgress);

const logs = JSON.stringify([
  ...happy.logger.records,
  ...startFailure.logger.records,
  ...terminalFailure.logger.records,
]);
assert.equal(logs.includes("private objective"), false);
assert.equal(logs.includes("private result summary"), false);
assert.equal(logs.includes("private append error"), false);

console.log("Runtime Subagent lifecycle smoke passed");
