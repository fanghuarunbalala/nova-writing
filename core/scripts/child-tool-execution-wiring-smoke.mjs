import assert from "node:assert/strict";
import { Type } from "typebox";
import {
  INPUT_EVENT_TYPE,
  INPUT_PRIORITY,
  RuntimeApprovalDecisionInputError,
  RuntimeApprovalDecisionInputHandler,
  ToolError,
  ToolGroupCatalog,
  ToolRegistry,
  ToolRegistryView,
  defineTool,
} from "../dist/index.js";
import {
  CHILD_TOOL_PERMISSION_RULES,
  createChildToolExecutionComposition,
} from "../dist/node/index.js";
import { DispatcherPiToolExecutionBridge } from "../dist/runtime/agent/pi/DispatcherPiToolExecutionBridge.js";
import { PiToolAdapter } from "../dist/runtime/agent/pi/PiToolAdapter.js";

const executed = [];
function fakeTool(name, parameters) {
  return defineTool({
    descriptor: {
      name,
      version: "1.0.0",
      label: name,
      description: `${name} smoke tool`,
      parameters: Type.Object(parameters),
    },
    handler: {
      async execute(_context, arguments_) {
        executed.push({ name, arguments: arguments_ });
        return {
          content: [{ type: "text", text: "ok" }],
        };
      },
    },
  });
}

const registry = new ToolRegistry([
  fakeTool("TodoWrite", { todos: Type.Any() }),
  fakeTool("NovelOutlineRead", { scope: Type.Any() }),
  fakeTool("NovelOutlineWrite", { values: Type.Any() }),
  fakeTool("NovelOutlineEdit", { values: Type.Any() }),
]);
const groups = new ToolGroupCatalog([
  {
    schemaVersion: 1,
    id: "child.smoke",
    version: "1.0.0",
    label: "Child Smoke",
    tools: ["TodoWrite", "NovelOutlineRead", "NovelOutlineWrite", "NovelOutlineEdit"],
  },
]);
const view = new ToolRegistryView({
  registry,
  groups,
  policy: { groupIds: ["child.smoke"] },
});

const events = [];
let sequence = 0;
const eventSink = {
  async append(event) {
    events.push(event);
    sequence += 1;
    return {
      status: "recorded",
      conversationId: "conv-tools",
      eventId: `evt-${sequence}`,
      sequence,
      recordedAt: "2026-08-05T00:00:00.000Z",
    };
  },
};

const composition = createChildToolExecutionComposition({
  registryView: view,
  eventSink,
});

// Provider-facing tool schemas include the full manifest Tool View.
const providerTools = new PiToolAdapter(
  new DispatcherPiToolExecutionBridge({
    dispatcher: composition.dispatcher,
    conversationId: "conv-tools",
    runId: "run-1",
  }),
).toAgentTools(view.listAllowed());
assert.deepEqual(
  providerTools.map((tool) => tool.name).sort(),
  ["NovelOutlineEdit", "NovelOutlineRead", "NovelOutlineWrite", "TodoWrite"],
);

const signal = new AbortController().signal;

// Read tools are allowed without approval.
await composition.dispatcher.execute(
  {
    conversationId: "conv-tools",
    runId: "run-1",
    toolCallId: "call-read",
    toolName: "NovelOutlineRead",
    toolVersion: "1.0.0",
    arguments: { scope: "draft" },
  },
  { signal },
);
assert.equal(executed.at(-1).name, "NovelOutlineRead");

// Write tools require approval; an approved decision proceeds.
const writePromise = composition.dispatcher.execute(
  {
    conversationId: "conv-tools",
    runId: "run-1",
    toolCallId: "call-write",
    toolName: "NovelOutlineWrite",
    toolVersion: "1.0.0",
    arguments: { values: [{ id: "s", title: "t" }] },
  },
  { signal },
);
const writeRequest = await waitForPending("NovelOutlineWrite");
assert.ok(writeRequest);
assert.ok(
  events.some(
    (event) => event.getEventType?.() === "system.tool.approval.requested",
  ),
);
await composition.coordinator.resolve(
  {
    id: "decision-write",
    conversationId: "conv-tools",
    eventType: INPUT_EVENT_TYPE.approvalDecision,
    direction: "input",
    priority: INPUT_PRIORITY.command,
    sequence: 1,
    timestamp: "2026-08-05T00:00:01.000Z",
    runId: writeRequest.identity.runId,
    payload: {
      approvalRequestId: writeRequest.approvalRequestId,
      decision: "approved",
      argumentDigest: writeRequest.identity.argumentDigest,
    },
  },
  { actorId: "smoke-user" },
);
await writePromise;
assert.equal(executed.at(-1).name, "NovelOutlineWrite");

// Edit tools require approval; a rejected decision fails with approval_rejected.
const editPromise = composition.dispatcher.execute(
  {
    conversationId: "conv-tools",
    runId: "run-1",
    toolCallId: "call-edit",
    toolName: "NovelOutlineEdit",
    toolVersion: "1.0.0",
    arguments: { values: [{ id: "s", value: { title: "x" } }] },
  },
  { signal },
);
const editRequest = await waitForPending("NovelOutlineEdit");
assert.ok(editRequest);
await composition.coordinator.resolve(
  {
    id: "decision-edit",
    conversationId: "conv-tools",
    eventType: INPUT_EVENT_TYPE.approvalDecision,
    direction: "input",
    priority: INPUT_PRIORITY.command,
    sequence: 2,
    timestamp: "2026-08-05T00:00:02.000Z",
    runId: editRequest.identity.runId,
    payload: {
      approvalRequestId: editRequest.approvalRequestId,
      decision: "rejected",
      argumentDigest: editRequest.identity.argumentDigest,
    },
  },
  { actorId: "smoke-user" },
);
await assert.rejects(
  () => editPromise,
  (error) =>
    error instanceof ToolError &&
    error.code === "TOOL_APPROVAL_REJECTED" &&
    error.category === "approval_rejected",
);

// Control approval decision handler enriches run/turn identity and records the outcome.
const resolveCalls = [];
const coordinatorStub = {
  async resolve(input, metadata) {
    resolveCalls.push({ input, metadata });
    return { outcome: "resolved" };
  },
};
const outcomeCalls = [];
const outcomeRecorderStub = {
  async record(options) {
    outcomeCalls.push(options);
    return { status: "recorded" };
  },
};
const handler = new RuntimeApprovalDecisionInputHandler({
  conversationId: "conv-tools",
  coordinator: coordinatorStub,
  runId: () => "run-9",
  turnId: () => "turn-9",
  outcomeRecorder: outcomeRecorderStub,
});
await handler.handle({
  id: "decision-handler",
  conversationId: "conv-tools",
  eventType: INPUT_EVENT_TYPE.approvalDecision,
  direction: "input",
  priority: INPUT_PRIORITY.command,
  sequence: 3,
  timestamp: "2026-08-05T00:00:03.000Z",
  payload: {
    approvalRequestId: "approval-handler",
    decision: "approved",
    argumentDigest: `sha256:${"a".repeat(64)}`,
  },
});
assert.equal(resolveCalls[0].input.runId, "run-9");
assert.equal(resolveCalls[0].input.turnId, "turn-9");
assert.equal(resolveCalls[0].metadata.actorId, "conversation:conv-tools");
assert.equal(outcomeCalls[0].outcome, "consumed");
await assert.rejects(
  () =>
    handler.handle({
      id: "decision-wrong-type",
      conversationId: "conv-tools",
      eventType: INPUT_EVENT_TYPE.systemStop,
      direction: "input",
      priority: INPUT_PRIORITY.system,
      sequence: 4,
      timestamp: "2026-08-05T00:00:04.000Z",
      payload: {},
    }),
  RuntimeApprovalDecisionInputError,
);

assert.ok(CHILD_TOOL_PERMISSION_RULES.length >= 2);
console.log("CORE_SMOKE_TEST_RESULT=pass child-tool-execution-wiring");

async function waitForPending(toolName) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const pending = await composition.coordinator.listPending();
    const request = pending.find(
      (candidate) => candidate.identity.toolName === toolName,
    );
    if (request !== undefined) return request;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return undefined;
}
