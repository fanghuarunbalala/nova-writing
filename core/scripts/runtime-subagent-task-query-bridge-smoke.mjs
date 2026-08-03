import assert from "node:assert/strict";
import {
  SUBAGENT_SCHEMA_VERSION,
  SubagentCompletionBridge,
  SubagentTaskProtocolError,
  SubagentTaskQueryService,
} from "../dist/index.js";

const timestamp = "2026-08-03T00:00:00.000Z";
const limits = {
  maximumPromptBytes: 4096,
  maximumArtifactReferences: 4,
  maximumResultBytes: 4096,
};

function binding(taskId, status, parentConversationId = "conversation-parent", parentRunId = "run-parent") {
  return {
    schemaVersion: SUBAGENT_SCHEMA_VERSION,
    subagentId: taskId,
    parentConversationId,
    parentRunId,
    childConversationId: `conversation-child-${taskId}`,
    depth: 1,
    agentType: "explore",
    definitionVersion: "1.0.0",
    toolPolicyId: "policy-child",
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

class MemoryBindings {
  constructor(entries) {
    this.entries = new Map(entries.map((entry) => [entry.subagentId, entry]));
  }

  async put(value) {
    this.entries.set(value.subagentId, value);
  }

  async get(taskId) {
    return this.entries.get(taskId);
  }

  async list() {
    return [...this.entries.values()];
  }

  subscribe() {
    throw new Error("not implemented");
  }
}

const entries = [
  binding("queued", "creating"),
  binding("running", "running"),
  binding("completed", "completed"),
  binding("failed", "failed"),
  binding("cancelled", "cancelled"),
  binding("orphaned", "orphaned"),
];
const bindings = new MemoryBindings(entries);
const presenceStates = new Map([
  ["conversation-child-queued", "offline"],
  ["conversation-child-running", "online"],
  ["conversation-child-completed", "offline"],
  ["conversation-child-failed", "crashed"],
  ["conversation-child-cancelled", "stopping"],
  ["conversation-child-orphaned", "offline"],
]);
const messages = new Map([
  ["conversation-child-completed", { content: "completed result", artifactReferences: [] }],
]);

const query = new SubagentTaskQueryService({
  bindings,
  runtimePresence: {
    async getRuntimePresence(conversationId) {
      return { state: presenceStates.get(conversationId) };
    },
  },
  finalAssistantMessages: {
    async readFinalAssistantMessage(conversationId) {
      return messages.get(conversationId);
    },
  },
  limits,
});

assert.equal((await query.get({
  parentConversationId: "conversation-parent",
  parentRunId: "run-parent",
  taskId: "missing",
})), undefined);
assert.equal((await query.get({
  parentConversationId: "conversation-other",
  parentRunId: "run-parent",
  taskId: "running",
})), undefined);

const queued = await query.get({ parentConversationId: "conversation-parent", parentRunId: "run-parent", taskId: "queued" });
assert.deepEqual(queued, {
  schemaVersion: 1,
  taskId: "queued",
  childConversationId: "conversation-child-queued",
  status: "queued",
  runtimePresence: "dormant",
});
const running = await query.get({ parentConversationId: "conversation-parent", parentRunId: "run-parent", taskId: "running" });
assert.equal(running.status, "running");
assert.equal(running.runtimePresence, "active");
const completed = await query.get({ parentConversationId: "conversation-parent", parentRunId: "run-parent", taskId: "completed" });
assert.equal(completed.status, "completed");
assert.deepEqual(completed.result, { content: "completed result", artifactReferences: [] });
assert.equal(Object.isFrozen(completed), true);
assert.equal(Object.isFrozen(completed.result), true);
assert.equal((await query.get({ parentConversationId: "conversation-parent", parentRunId: "run-parent", taskId: "failed" })).runtimePresence, "absent");
assert.equal((await query.get({ parentConversationId: "conversation-parent", parentRunId: "run-parent", taskId: "cancelled" })).runtimePresence, "dormant");

const delivered = [];
const bridge = new SubagentCompletionBridge({
  bindings,
  finalAssistantMessages: {
    async readFinalAssistantMessage(conversationId) {
      return messages.get(conversationId);
    },
  },
  resultSink: {
    async deliverResult(result) {
      delivered.push(result);
      return result;
    },
  },
});

const completedResult = await bridge.reconcile({
  subagentId: "completed",
  status: "completed",
  completedAt: timestamp,
});
assert.equal(completedResult.status, "completed");
assert.equal(completedResult.summary, "completed result");
assert.equal(delivered.length, 1);

const failedResult = await bridge.reconcile({
  subagentId: "failed",
  status: "failed",
  completedAt: timestamp,
  errorCode: "CHILD_FAILED",
});
assert.equal(failedResult.status, "failed");
assert.equal(failedResult.errorCode, "CHILD_FAILED");

const cancelledResult = await bridge.reconcile({
  subagentId: "cancelled",
  status: "cancelled",
  completedAt: timestamp,
  cancellationReason: "explicit",
});
assert.equal(cancelledResult.status, "cancelled");
assert.equal(cancelledResult.cancellationReason, "explicit");

const orphanedResult = await bridge.reconcile({
  subagentId: "orphaned",
  status: "orphaned",
  completedAt: timestamp,
  cancellationReason: "orphan_reclaimed",
});
assert.equal(orphanedResult.status, "orphaned");

messages.delete("conversation-child-completed");
const emptyResult = await bridge.reconcile({
  subagentId: "completed",
  status: "completed",
  completedAt: timestamp,
});
assert.equal(emptyResult.status, "failed");
assert.equal(emptyResult.errorCode, "SUBAGENT_EMPTY_RESULT");

await assert.rejects(
  bridge.reconcile({ subagentId: "missing", status: "completed", completedAt: timestamp }),
  (error) => error instanceof SubagentTaskProtocolError && error.failure === "task_not_found",
);

console.log("Runtime Subagent Task query/bridge smoke passed");
