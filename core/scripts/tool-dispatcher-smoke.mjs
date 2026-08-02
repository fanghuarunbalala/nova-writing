import assert from "node:assert/strict";
import { Type } from "typebox";
import {
  ApprovalDecisionInputEvent,
  InMemoryInteractionCoordinator,
  INITIAL_TOOL_PERMISSION_RULES,
  LayeredToolPermissionPolicy,
  StaticToolExecutionPolicyResolver,
  TOOL_GROUP_MANIFEST_SCHEMA_VERSION,
  ToolDispatcher,
  ToolError,
  ToolExecutionPipeline,
  ToolGroupCatalog,
  ToolRegistryAssembler,
  ToolRegistryView,
  TrustedProcessSandboxExecutor,
  defineTool,
} from "../dist/index.js";

class CollectingSink {
  constructor() { this.events = []; }
  async append(event) {
    this.events.push(event);
    return {
      status: "recorded",
      conversationId: event.conversationId,
      eventId: event.id,
      sequence: this.events.length,
      recordedAt: event.timestamp,
    };
  }
}

class CollectingLogger {
  constructor(entries = [], bindings = {}) { this.entries = entries; this.bindings = bindings; }
  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }
  child(bindings) { return new CollectingLogger(this.entries, { ...this.bindings, ...bindings }); }
  record(level, event, fields) { this.entries.push({ level, event, fields: { ...this.bindings, ...fields } }); }
}

const secret = "DO_NOT_EXPOSE_TOOL_ARGUMENT_OR_ERROR";
const calls = [];
const tools = [
  tool("read_file", Type.Object({ path: Type.String() }), async (context, arguments_, progress) => {
    calls.push(["read_file", context.toolCallId, arguments_.path]);
    await progress.emit({ kind: "progress", completed: 1, total: 1 });
    return { content: [{ type: "text", text: "chapter" }], details: { count: 1 } };
  }),
  tool("write_file", Type.Object({ text: Type.String() }), async (_context, arguments_) => {
    calls.push(["write_file", arguments_.text]);
    return { content: [{ type: "text", text: "written" }] };
  }),
  tool("isolated_tool", Type.Object({}), async () => {
    calls.push(["isolated_tool"]);
    return { content: [] };
  }),
  tool("failing_tool", Type.Object({}), async () => {
    throw new Error(secret);
  }),
  tool("oversized_tool", Type.Object({}), async () => ({
    content: [{ type: "text", text: "x".repeat(200) }],
  })),
];
const assembler = new ToolRegistryAssembler();
for (const registered of tools) assembler.register(registered);
const registry = assembler.freeze();
const catalog = new ToolGroupCatalog([{
  schemaVersion: TOOL_GROUP_MANIFEST_SCHEMA_VERSION,
  id: "runtime",
  version: "1.0.0",
  label: "Runtime tools",
  tools: tools.map((registered) => registered.descriptor.name),
}]);
const registryView = new ToolRegistryView({
  registry,
  groups: catalog,
  policy: { groupIds: ["runtime"] },
});
const trustedPolicy = {
  timeoutMs: 30_000,
  isolation: "trusted_process",
  cancellable: true,
  idempotent: false,
  restartable: false,
  checkpointable: false,
  retry: { maximumAttempts: 1 },
};
const policyResolver = new StaticToolExecutionPolicyResolver(
  tools.map((registered) => ({
    toolName: registered.descriptor.name,
    toolVersion: registered.descriptor.version,
    policy: registered.descriptor.name === "isolated_tool"
      ? { ...trustedPolicy, isolation: "os_process" }
      : trustedPolicy,
  })),
);
const permissionPolicy = new LayeredToolPermissionPolicy([
  ...INITIAL_TOOL_PERMISSION_RULES,
  {
    ruleId: "workspace.allow_runtime_tools",
    source: "workspace",
    effect: "allow",
    match: { toolNames: ["read_file", "isolated_tool", "failing_tool", "oversized_tool"] },
  },
  {
    ruleId: "workspace.ask_write",
    source: "workspace",
    effect: "ask",
    match: { toolNames: ["write_file"] },
  },
]);
const sink = new CollectingSink();
const coordinator = new InMemoryInteractionCoordinator({ eventSink: sink });
const logs = [];
const progress = [];
const sandbox = new TrustedProcessSandboxExecutor();
assert.deepEqual(sandbox.capabilities, {
  executorId: "trusted_process",
  isolation: "none",
});
const pipeline = new ToolExecutionPipeline({
  registryView,
  argumentDigester: {
    async digest() { return `sha256:${"a".repeat(64)}`; },
  },
  executionPolicyResolver: policyResolver,
  permissionPolicy,
  interactionCoordinator: coordinator,
  approvalRequestFactory: {
    create(input) {
      return {
        approvalRequestId: `approval-${input.identity.toolCallId}`,
        identity: input.identity,
        ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
        summary: { title: input.toolLabel },
        requestedAt: "2026-08-02T02:00:00.000Z",
        expiresAt: "2026-08-02T02:05:00.000Z",
      };
    },
  },
  sandboxExecutor: sandbox,
  resultLimits: {
    maximumContentBlocks: 4,
    maximumTextBytes: 64,
    maximumDetailsBytes: 64,
    maximumArtifactReferences: 2,
  },
  traceSink: { async append() {} },
  logger: new CollectingLogger(logs),
});
const dispatcher = new ToolDispatcher(pipeline);

const readResult = await dispatcher.execute(
  invocation("read-call", "read_file", { path: secret }),
  {
    signal: new AbortController().signal,
    progress: { async emit(update) { progress.push(update); } },
  },
);
assert.equal(readResult.content[0].text, "chapter");
assert.equal(Object.isFrozen(readResult), true);
assert.deepEqual(progress, [{ kind: "progress", completed: 1, total: 1 }]);

const writePromise = dispatcher.execute(
  invocation("write-call", "write_file", { text: secret }),
  { signal: new AbortController().signal },
);
const pending = await waitForPending(coordinator);
assert.equal(pending.length, 1);
assert.equal(JSON.stringify(pending[0]).includes(secret), false);
await coordinator.resolve(
  persistedApproval(pending[0], "input-write-approval", 1),
  { actorId: "local_user" },
);
assert.equal((await writePromise).content[0].text, "written");

await assertToolError(
  () => dispatcher.execute(invocation("invalid-call", "read_file", { path: 1 }), {
    signal: new AbortController().signal,
  }),
  "TOOL_ARGUMENTS_INVALID",
  "validation",
  "none",
);
await assertToolError(
  () => dispatcher.execute(invocation("unknown-call", "missing_tool", {}), {
    signal: new AbortController().signal,
  }),
  "TOOL_NOT_AVAILABLE",
  "validation",
  "none",
);
await assertToolError(
  () => dispatcher.execute(invocation("isolated-call", "isolated_tool", {}), {
    signal: new AbortController().signal,
  }),
  "TOOL_PERMISSION_DENIED",
  "permission",
  "none",
);
await assertToolError(
  () => dispatcher.execute(invocation("failing-call", "failing_tool", {}), {
    signal: new AbortController().signal,
  }),
  "TOOL_HANDLER_FAILED",
  "execution",
  "completed_unknown",
);
await assertToolError(
  () => dispatcher.execute(invocation("oversized-call", "oversized_tool", {}), {
    signal: new AbortController().signal,
  }),
  "TOOL_RESULT_INVALID",
  "execution",
  "completed_unknown",
);
const aborted = new AbortController();
aborted.abort();
await assertToolError(
  () => dispatcher.execute(invocation("cancelled-call", "read_file", { path: secret }), {
    signal: aborted.signal,
  }),
  "TOOL_EXECUTION_CANCELLED",
  "cancelled",
  "none",
);

assert.equal(calls.some(([name]) => name === "isolated_tool"), false);
const serializedLogs = JSON.stringify(logs);
for (const forbidden of [secret, "payload", "content", "details", "stack", "cause", "path"]) {
  assert.equal(serializedLogs.includes(forbidden), false);
}
console.log("tool dispatcher smoke passed");

function tool(name, parameters, execute) {
  return defineTool({
    descriptor: {
      name,
      version: "1.0.0",
      label: name.replaceAll("_", " "),
      description: `Runs ${name}.`,
      parameters,
    },
    handler: { execute },
  });
}

function invocation(toolCallId, toolName, arguments_) {
  return {
    conversationId: "conversation-dispatcher",
    runId: "run-dispatcher",
    turnId: "turn-dispatcher",
    toolCallId,
    toolName,
    arguments: arguments_,
  };
}

function persistedApproval(request, id, sequence) {
  const event = new ApprovalDecisionInputEvent({
    id,
    conversationId: request.identity.conversationId,
    runId: request.identity.runId,
    turnId: request.turnId,
    timestamp: "2026-08-02T02:00:01.000Z",
    approvalRequestId: request.approvalRequestId,
    decision: "approved",
    argumentDigest: request.identity.argumentDigest,
  });
  return {
    ...event.getSnapshot(),
    direction: "input",
    sequence,
    recordedAt: event.timestamp,
  };
}

async function assertToolError(invoke, code, category, sideEffectStatus) {
  await assert.rejects(invoke, (error) => {
    assert.equal(error instanceof ToolError, true);
    assert.equal(error.code, code);
    assert.equal(error.category, category);
    assert.equal(error.sideEffectStatus, sideEffectStatus);
    assert.equal(String(error).includes(secret), false);
    assert.equal(JSON.stringify(error).includes(secret), false);
    return true;
  });
}

async function waitForPending(coordinator) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pending = await coordinator.listPending();
    if (pending.length > 0) return pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return coordinator.listPending();
}
