import assert from "node:assert/strict";
import { Type } from "typebox";
import {
  INPUT_EVENT_TYPE,
  INPUT_PRIORITY,
  RuntimeApprovalDecisionInputError,
  RuntimeApprovalDecisionInputHandler,
  ComposeModeStateProvider,
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
  fakeTool("Read", { file_path: Type.String() }),
  fakeTool("Glob", { pattern: Type.String() }),
  fakeTool("Write", { file_path: Type.String(), content: Type.String() }),
  fakeTool("Edit", {
    file_path: Type.String(),
    old_string: Type.String(),
    new_string: Type.String(),
  }),
]);
const groups = new ToolGroupCatalog([
  {
    schemaVersion: 1,
    id: "child.smoke",
    version: "1.0.0",
    label: "Child Smoke",
    tools: [
      "TodoWrite",
      "NovelOutlineRead",
      "NovelOutlineWrite",
      "NovelOutlineEdit",
      "Read",
      "Glob",
      "Write",
      "Edit",
    ],
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

const composeState = new ComposeModeStateProvider();
const composition = createChildToolExecutionComposition({
  registryView: view,
  eventSink,
  runtimeInstanceId: "runtime-instance-smoke",
  composeStateProvider: composeState,
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
  [
    "Edit",
    "Glob",
    "NovelOutlineEdit",
    "NovelOutlineRead",
    "NovelOutlineWrite",
    "Read",
    "TodoWrite",
    "Write",
  ],
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
    arguments: {
      baseRevision: "revision_tool_execution_base",
      values: [{ id: "s", title: "t" }],
    },
  },
  { signal },
);
const writeRequest = await waitForPending("NovelOutlineWrite");
assert.ok(writeRequest);
assert.equal(writeRequest.summary.title, "新增大纲单元");
assert.deepEqual(writeRequest.summary.operations, [
  { op: "add", kind: "outline", id: "s", title: "t" },
]);
assert.deepEqual(writeRequest.summary.arguments, {
  baseRevision: "revision_tool_execution_base",
  values: [{ id: "s", title: "t" }],
});
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
    arguments: {
      baseRevision: "revision_tool_execution_base",
      values: [{ id: "s", value: { title: "x" } }],
    },
  },
  { signal },
);
const editRequest = await waitForPending("NovelOutlineEdit");
assert.ok(editRequest);
assert.equal(editRequest.summary.title, "修改大纲单元");
assert.deepEqual(editRequest.summary.operations, [
  { op: "edit", kind: "outline", id: "s", title: "x" },
]);
assert.deepEqual(editRequest.summary.arguments, {
  baseRevision: "revision_tool_execution_base",
  values: [{ id: "s", value: { title: "x" } }],
});
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

// runtime.files 权限：Read/Glob/Write/Edit 全模式放行（child_files_allow）；作用域由 FileToolService 强制。
// runtime.files permissions: Read/Glob/Write/Edit are allowed in all modes (child_files_allow); scope is enforced by FileToolService.
await composition.dispatcher.execute(
  {
    conversationId: "conv-tools",
    runId: "run-1",
    toolCallId: "call-file-read",
    toolName: "Read",
    toolVersion: "1.0.0",
    arguments: { file_path: "/design/chapter-1.md" },
  },
  { signal },
);
assert.equal(executed.at(-1).name, "Read");

await composition.dispatcher.execute(
  {
    conversationId: "conv-tools",
    runId: "run-1",
    toolCallId: "call-file-glob",
    toolName: "Glob",
    toolVersion: "1.0.0",
    arguments: { pattern: "**/*.md" },
  },
  { signal },
);
assert.equal(executed.at(-1).name, "Glob");

await composition.dispatcher.execute(
  {
    conversationId: "conv-tools",
    runId: "run-1",
    toolCallId: "call-file-write",
    toolName: "Write",
    toolVersion: "1.0.0",
    arguments: { file_path: "/design/chapter-1.md", content: "x" },
  },
  { signal },
);
assert.equal(executed.at(-1).name, "Write");

await composition.dispatcher.execute(
  {
    conversationId: "conv-tools",
    runId: "run-1",
    toolCallId: "call-file-edit",
    toolName: "Edit",
    toolVersion: "1.0.0",
    arguments: {
      file_path: "/design/chapter-1.md",
      old_string: "a",
      new_string: "b",
    },
  },
  { signal },
);
assert.equal(executed.at(-1).name, "Edit");

// Compose 激活：canonical 写 deny；文件工具不再按 compose 门控（全模式可用，作用域由 FileToolService 强制）。
// While compose is active: canonical writes are denied; file tools are not compose-gated (sandbox enforced by FileToolService).
const designFilePath = "/workspace/.novel/design/conv-tools.md";
composeState.enter("conv-tools", { designFilePath });

await composition.dispatcher.execute(
  {
    conversationId: "conv-tools",
    runId: "run-1",
    toolCallId: "call-compose-read",
    toolName: "Read",
    toolVersion: "1.0.0",
    arguments: { file_path: "/workspace/.novel/design/chapter-1.md" },
  },
  { signal },
);
assert.equal(executed.at(-1).name, "Read");

// 文件工具全模式可用：compose 激活时不再限 design 作用域。
await composition.dispatcher.execute(
  {
    conversationId: "conv-tools",
    runId: "run-1",
    toolCallId: "call-compose-read-outside",
    toolName: "Read",
    toolVersion: "1.0.0",
    arguments: { file_path: "/workspace/outside.md" },
  },
  { signal },
);
assert.equal(executed.at(-1).name, "Read");

await composition.dispatcher.execute(
  {
    conversationId: "conv-tools",
    runId: "run-1",
    toolCallId: "call-compose-write",
    toolName: "Write",
    toolVersion: "1.0.0",
    arguments: { file_path: designFilePath, content: "x" },
  },
  { signal },
);
assert.equal(executed.at(-1).name, "Write");

await composition.dispatcher.execute(
  {
    conversationId: "conv-tools",
    runId: "run-1",
    toolCallId: "call-compose-write-other",
    toolName: "Write",
    toolVersion: "1.0.0",
    arguments: { file_path: "/workspace/.novel/design/other.md", content: "x" },
  },
  { signal },
);
assert.equal(executed.at(-1).name, "Write");

await assert.rejects(
  () =>
    composition.dispatcher.execute(
      {
        conversationId: "conv-tools",
        runId: "run-1",
        toolCallId: "call-compose-canonical",
        toolName: "NovelOutlineWrite",
        toolVersion: "1.0.0",
        arguments: { values: [{ id: "s", title: "t" }] },
      },
      { signal },
    ),
  (error) =>
    error instanceof ToolError && error.code === "TOOL_PERMISSION_DENIED",
);

// 批准（inactive）：恢复透传——文件工具仍放行（child_files_allow），canonical 写回到 ask。
// After approval the policy passes through: file tools remain allowed (child_files_allow), canonical writes return to ask.
composeState.approve("conv-tools");
await composition.dispatcher.execute(
  {
    conversationId: "conv-tools",
    runId: "run-1",
    toolCallId: "call-after-compose-write",
    toolName: "Write",
    toolVersion: "1.0.0",
    arguments: { file_path: designFilePath, content: "x" },
  },
  { signal },
);
assert.equal(executed.at(-1).name, "Write");

const composeCanonicalPromise = composition.dispatcher.execute(
  {
    conversationId: "conv-tools",
    runId: "run-1",
    toolCallId: "call-after-compose-canonical",
    toolName: "NovelOutlineWrite",
    toolVersion: "1.0.0",
    arguments: {
      baseRevision: "revision_tool_execution_base",
      values: [{ id: "s2", title: "t2" }],
    },
  },
  { signal },
);
const composeCanonicalRequest = await waitForPending("NovelOutlineWrite");
assert.ok(composeCanonicalRequest);
await composition.coordinator.resolve(
  {
    id: "decision-compose",
    conversationId: "conv-tools",
    eventType: INPUT_EVENT_TYPE.approvalDecision,
    direction: "input",
    priority: INPUT_PRIORITY.command,
    sequence: 5,
    timestamp: "2026-08-05T00:00:05.000Z",
    runId: composeCanonicalRequest.identity.runId,
    payload: {
      approvalRequestId: composeCanonicalRequest.approvalRequestId,
      decision: "approved",
      argumentDigest: composeCanonicalRequest.identity.argumentDigest,
    },
  },
  { actorId: "smoke-user" },
);
await composeCanonicalPromise;
assert.equal(executed.at(-1).name, "NovelOutlineWrite");

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
