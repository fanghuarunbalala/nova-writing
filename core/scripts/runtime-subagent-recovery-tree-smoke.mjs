import assert from "node:assert/strict";
import {
  DefaultChildConversationManager,
  DefaultSubagentLifecycleCoordinator,
  DurableChildConversationManager,
  InMemorySubagentBindingStore,
  ConversationTreeObserver,
  SUBAGENT_CANCELLATION_REASON,
  SUBAGENT_SCHEMA_VERSION,
  SUBAGENT_TOOL_POLICY_RELATION,
  SubagentCancellationCoordinator,
  createCoreEventSchemaRegistry,
} from "../dist/index.js";

const now = "2026-08-02T10:00:00.000Z";

function request(subagentId, parentConversationId = "conversation-parent", parentRunId = "run-parent") {
  return { schemaVersion: SUBAGENT_SCHEMA_VERSION, subagentId, parentConversationId, parentRunId, agentType: "explore", definitionVersion: "v1", objective: `private ${subagentId}`, toolPolicyId: "policy-child", requestedAt: now };
}

const store = new InMemorySubagentBindingStore();
const baseManager = new DefaultChildConversationManager({
  parentScopeReader: { async readParentScope(input) { return { parentConversationId: input.parentConversationId, parentRunId: input.parentRunId, workspaceId: "workspace-main", depth: 0, toolPolicyId: "policy-parent" }; } },
  toolPolicyRelationReader: { async readRelation() { return SUBAGENT_TOOL_POLICY_RELATION.reduced; } },
  creationPort: { async createChild(input) { return { childConversationId: `conversation-child-${input.subagentId}`, createdAt: now }; } },
  activationPort: { async activateChild() {} },
  rollbackPort: { async rollbackChild() {} },
  clock: { now: () => now },
});
const manager = new DurableChildConversationManager(baseManager, store);
const registry = createCoreEventSchemaRegistry();
const events = [];
const lifecycle = new DefaultSubagentLifecycleCoordinator({
  manager,
  eventSink: { async append(event) { const snapshot = registry.validateOutput(event.getSnapshot()); events.push(snapshot); return { status: "recorded", conversationId: snapshot.conversationId, eventId: snapshot.id, sequence: events.length, recordedAt: snapshot.timestamp }; } },
  eventIdFactory: { create(input) { return `event-${input.subagentId}-${input.eventType}-${input.ordinal}`; } },
  clock: { now: () => now },
});
const activeParents = new Set(["conversation-active\u0000run-active"]);
const cancellationPort = {
  async cancelChild(binding, reason) {
    const orphaned = reason === SUBAGENT_CANCELLATION_REASON.orphanReclaimed;
    return { schemaVersion: SUBAGENT_SCHEMA_VERSION, subagentId: binding.subagentId, parentConversationId: binding.parentConversationId, parentRunId: binding.parentRunId, childConversationId: binding.childConversationId, status: orphaned ? "orphaned" : "cancelled", artifactReferences: [], cancellationReason: reason, completedAt: now };
  },
};
const cancellation = new SubagentCancellationCoordinator({
  store,
  lifecycle,
  cancellationPort,
  parentRunActivityReader: { async isParentRunActive(conversationId, runId) { return activeParents.has(`${conversationId}\u0000${runId}`); } },
});
const observer = new ConversationTreeObserver(store);
const subscription = observer.subscribe();

await lifecycle.start(request("one"));
await lifecycle.start(request("two"));
assert.deepEqual((await observer.getTree("conversation-parent")).children.map((binding) => binding.subagentId), ["one", "two"]);
assert.equal((await subscription[Symbol.asyncIterator]().next()).value.binding.subagentId, "one");
assert.equal((await subscription[Symbol.asyncIterator]().next()).value.binding.subagentId, "two");

const cancelled = await cancellation.cancelForParent("conversation-parent", "run-parent", "stopped");
assert.equal(cancelled.length, 2);
assert.equal(cancelled.every((result) => result.status === "cancelled" && result.cancellationReason === "parent_stopped"), true);
assert.equal((await store.list({ activeOnly: true })).length, 0);

await lifecycle.start(request("active", "conversation-active", "run-active"));
await lifecycle.start(request("orphan", "conversation-orphan", "run-orphan"));
const reclaimed = await cancellation.reclaimOrphans();
assert.deepEqual(reclaimed.map((result) => [result.subagentId, result.status, result.cancellationReason]), [["orphan", "orphaned", "orphan_reclaimed"]]);
assert.equal((await store.get("active")).status, "running");
assert.equal((await store.get("orphan")).status, "orphaned");

const afterSequence = store.subscribe(5);
await lifecycle.start(request("catchup", "conversation-catchup", "run-catchup"));
const catchup = await afterSequence[Symbol.asyncIterator]().next();
assert.equal(catchup.value.sequence > 5, true);
await afterSequence.close();
await subscription.close();

console.log("Runtime Subagent recovery and tree smoke passed");
