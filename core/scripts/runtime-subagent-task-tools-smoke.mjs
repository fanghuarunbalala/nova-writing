import assert from "node:assert/strict";
import { Compile } from "typebox/compile";
import {
  SUBAGENT_SCHEMA_VERSION,
  SubagentDefinitionCatalog,
  SubagentTaskQueryService,
  ToolError,
  createAgentExecutionToolRegistry,
} from "../dist/index.js";

const timestamp = "2026-08-03T00:00:00.000Z";
const limits = {
  maximumPromptBytes: 4096,
  maximumArtifactReferences: 4,
  maximumResultBytes: 4096,
};

const definitions = new SubagentDefinitionCatalog([
  {
    agentType: "write",
    definitionVersion: "1.0.0",
    label: "Writer",
    description: "Draft bounded prose.",
    toolPolicyId: "policy-write",
  },
  {
    agentType: "explore",
    definitionVersion: "2.0.0",
    label: "Explorer",
    description: "Inspect bounded evidence.",
    toolPolicyId: "policy-explore",
  },
]);

function binding(taskId, status, parentConversationId = "conversation-parent", parentRunId = "run-parent") {
  return {
    schemaVersion: SUBAGENT_SCHEMA_VERSION,
    subagentId: taskId,
    parentConversationId,
    parentRunId,
    childConversationId: `conversation-child-${taskId}`,
    depth: 1,
    agentType: "explore",
    definitionVersion: "2.0.0",
    toolPolicyId: "policy-explore",
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

class MemoryBindings {
  constructor(entries = []) {
    this.entries = new Map(entries.map((entry) => [entry.subagentId, entry]));
  }
  async put(value) { this.entries.set(value.subagentId, value); }
  async get(taskId) { return this.entries.get(taskId); }
  async list() { return [...this.entries.values()]; }
  subscribe() { throw new Error("not implemented"); }
}

const bindings = new MemoryBindings([
  binding("running", "running"),
  binding("done", "completed"),
]);
const spawnRequests = [];
const cancellationRequests = [];
const querySnapshots = new Map([
  ["running", {
    schemaVersion: 1,
    taskId: "running",
    childConversationId: "conversation-child-running",
    status: "running",
    runtimePresence: "active",
  }],
  ["done", {
    schemaVersion: 1,
    taskId: "done",
    childConversationId: "conversation-child-done",
    status: "completed",
    runtimePresence: "absent",
    result: {
      content: "The completed body text.",
      artifactReferences: [],
    },
  }],
]);
const query = new SubagentTaskQueryService({
  bindings,
  runtimePresence: {
    async getRuntimePresence() {
      return { state: "online", observedAt: timestamp };
    },
  },
  finalAssistantMessages: {
    async readFinalAssistantMessage() { return undefined; },
  },
  limits,
});

const registry = createAgentExecutionToolRegistry({
  definitions,
  policy: {
    allowedAgentTypes: ["write", "explore"],
    limits,
  },
  manager: {
    async spawn(request) {
      spawnRequests.push(request);
      const created = binding(request.subagentId, "running");
      bindings.entries.set(created.subagentId, created);
      return created;
    },
    async recordTerminalStatus() { throw new Error("not implemented"); },
    getBinding(taskId) { return bindings.entries.get(taskId); },
    listBindings() { return [...bindings.entries.values()]; },
    getCapacity() { return { activeGlobal: 0, activeForParentRun: 0 }; },
  },
  bindings,
  query: {
    async get(scope) { return querySnapshots.get(scope.taskId); },
  },
  cancellation: {
    async requestCancellation(value, reason) {
      cancellationRequests.push({ value, reason });
      return "cancellation_requested";
    },
  },
  pollIntervalMs: 10,
  taskIdFactory: { create() { return "task-created"; } },
  clock: { now() { return timestamp; } },
});

assert.deepEqual(registry.list().map((tool) => tool.descriptor.name), ["Agent", "TaskOutput", "TaskStop"]);
const agent = registry.require("Agent");
assert.match(agent.descriptor.description, /explore \(Explorer\): Inspect bounded evidence\./);
assert.match(agent.descriptor.description, /write \(Writer\): Draft bounded prose\./);
assert.equal(Compile(agent.descriptor.parameters).Check({ agentType: "explore", prompt: "scan" }), true);
assert.equal(Compile(agent.descriptor.parameters).Check({ agentType: "unknown", prompt: "scan" }), false);

const context = {
  conversationId: "conversation-parent",
  runId: "run-parent",
  turnId: "turn-parent",
  toolCallId: "tool-call-1",
  signal: new AbortController().signal,
};
const accepted = await agent.handler.execute(context, {
  agentType: "explore",
  prompt: "Inspect the bounded evidence.",
}, { emit: async () => {} });
assert.equal(accepted.details.taskId, "task-created");
assert.equal(accepted.details.status, "running");
assert.equal(spawnRequests.length, 1);
assert.equal(spawnRequests[0].artifactReferences, undefined);
assert.equal(spawnRequests[0].definitionVersion, "2.0.0");
assert.equal(spawnRequests[0].toolPolicyId, "policy-explore");
assert.equal(spawnRequests[0].parentConversationId, "conversation-parent");
assert.equal(spawnRequests[0].parentRunId, "run-parent");

const taskOutput = registry.require("TaskOutput");
const snapshot = await taskOutput.handler.execute(
  context,
  { runIds: ["running"] },
  { emit: async () => {} },
);
assert.equal(snapshot.details.retrieval, "snapshot");
assert.equal(snapshot.details.runs.length, 1);
assert.equal(snapshot.details.runs[0].status, "running");
// 无 result 的 run：content 只含状态行（保持原约定）。
// A run without a result keeps a plain status line in content.
assert.equal(snapshot.content[0].text, "1 run(s).\n- running: running");

const doneSnapshot = await taskOutput.handler.execute(
  context,
  { runIds: ["done"] },
  { emit: async () => {} },
);
assert.equal(doneSnapshot.details.retrieval, "snapshot");
assert.equal(doneSnapshot.details.runs.length, 1);
// 有 result 的 run：正文进 content，模型当轮可见完整输出。
// A run with a result has its body in content for the live turn.
assert.match(doneSnapshot.content[0].text, /^1 run\(s\)\.\n- done: completed\n\nThe completed body text\.$/);
assert.equal(doneSnapshot.details.runs[0].result.content, "The completed body text.");

const success = await taskOutput.handler.execute(
  context,
  { runIds: ["running", "done"], block: true, timeout: 100 },
  { emit: async () => {} },
);
assert.equal(success.details.retrieval, "success");
assert.equal(success.details.run.taskId, "done");
assert.equal(success.details.run.status, "completed");
assert.equal(success.details.otherRuns.length, 1);
assert.equal(success.details.otherRuns[0].taskId, "running");
// 终态 run 的正文拼进 content；details 通道不受影响。
// The terminal run's body is appended to content; details is unchanged.
assert.match(success.content[0].text, /^Run done reached completed\.\n\nThe completed body text\.$/);
assert.equal(success.details.run.result.content, "The completed body text.");

const timedOut = await taskOutput.handler.execute(
  context,
  { runIds: ["running"], block: true, timeout: 20 },
  { emit: async () => {} },
);
assert.equal(timedOut.details.retrieval, "timeout");
assert.equal(timedOut.details.runs.length, 1);

await assert.rejects(
  taskOutput.handler.execute(
    context,
    { runIds: ["missing"] },
    { emit: async () => {} },
  ),
  (error) => error instanceof ToolError && error.code === "SUBAGENT_TASK_NOT_FOUND",
);

const taskStop = registry.require("TaskStop");
const cancellation = await taskStop.handler.execute(context, { taskId: "running" }, { emit: async () => {} });
assert.equal(cancellation.details.status, "cancellation_requested");
assert.equal(cancellationRequests.length, 1);
assert.equal(cancellationRequests[0].reason, "explicit");
const terminalCancellation = await taskStop.handler.execute(context, { taskId: "done" }, { emit: async () => {} });
assert.equal(terminalCancellation.details.status, "already_terminal");
const missingCancellation = await taskStop.handler.execute(context, { taskId: "missing" }, { emit: async () => {} });
assert.equal(missingCancellation.details.status, "not_found");
const foreignCancellation = await taskStop.handler.execute({ ...context, runId: "run-foreign" }, { taskId: "running" }, { emit: async () => {} });
assert.equal(foreignCancellation.details.status, "not_found");

console.log("Runtime Agent Execution Tools smoke passed");
