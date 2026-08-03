import assert from "node:assert/strict";
import { Type } from "typebox";
import {
  ApprovalDecisionInputEvent,
  InMemoryInteractionCoordinator,
  LayeredToolPermissionPolicy,
  RuntimeEventToolTraceSink,
  StaticToolExecutionPolicyResolver,
  TOOL_CANCEL_OUTCOME,
  TOOL_GROUP_MANIFEST_SCHEMA_VERSION,
  ToolDispatcher,
  ToolError,
  ToolExecutionPipeline,
  ToolGroupCatalog,
  ToolRegistryAssembler,
  ToolRegistryView,
  TrustedProcessSandboxExecutor,
  createCoreEventSchemaRegistry,
  defineTool,
} from "../dist/index.js";

class CollectingEventSink {
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

const secret = "DO_NOT_EXPOSE_CONTROL_TOOL_DATA";
let retryCalls = 0;
let noRetryCalls = 0;
let cancelStartedResolve;
const cancelStarted = new Promise((resolve) => { cancelStartedResolve = resolve; });
const tools = [
  tool("RetryTool", async () => {
    retryCalls += 1;
    if (retryCalls === 1) {
      throw new ToolError({
        code: "TOOL_TEMPORARY_FAILURE",
        category: "execution",
        retryable: true,
        sideEffectStatus: "none",
      });
    }
    return { content: [{ type: "text", text: "retried" }] };
  }),
  tool("NoRetryTool", async () => {
    noRetryCalls += 1;
    throw new ToolError({
      code: "TOOL_PARTIAL_FAILURE",
      category: "execution",
      retryable: true,
      sideEffectStatus: "possible",
    });
  }),
  tool("TimeoutTool", async (context) => waitForAbort(context.signal, "none")),
  tool("CancelTool", async (context) => {
    cancelStartedResolve();
    return waitForAbort(context.signal, "possible");
  }),
  tool("ApprovalTool", async () => ({ content: [] })),
];
const assembler = new ToolRegistryAssembler();
for (const registered of tools) assembler.register(registered);
const registry = assembler.freeze();
const groups = new ToolGroupCatalog([{
  schemaVersion: TOOL_GROUP_MANIFEST_SCHEMA_VERSION,
  id: "control",
  version: "1.0.0",
  label: "Control tools",
  tools: tools.map((registered) => registered.descriptor.name),
}]);
const registryView = new ToolRegistryView({
  registry,
  groups,
  policy: { groupIds: ["control"] },
});
const defaultPolicy = {
  timeoutMs: 5_000,
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
    policy: registered.descriptor.name === "RetryTool" ||
      registered.descriptor.name === "NoRetryTool"
      ? { ...defaultPolicy, idempotent: true, retry: { maximumAttempts: 2 } }
      : registered.descriptor.name === "TimeoutTool"
        ? { ...defaultPolicy, timeoutMs: 10, idempotent: true, retry: { maximumAttempts: 2 } }
        : defaultPolicy,
  })),
);
const permissionPolicy = new LayeredToolPermissionPolicy([
  {
    ruleId: "workspace.allow_control",
    source: "workspace",
    effect: "allow",
    match: { toolNames: ["RetryTool", "NoRetryTool", "TimeoutTool", "CancelTool"] },
  },
  {
    ruleId: "workspace.ask_approval",
    source: "workspace",
    effect: "ask",
    match: { toolNames: ["ApprovalTool"] },
  },
]);
const eventSink = new CollectingEventSink();
const coordinator = new InMemoryInteractionCoordinator({ eventSink });
const traceSink = new RuntimeEventToolTraceSink({ eventSink });
const dispatcher = new ToolDispatcher(new ToolExecutionPipeline({
  registryView,
  argumentDigester: { async digest() { return `sha256:${"c".repeat(64)}`; } },
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
        requestedAt: "2026-08-02T03:00:00.000Z",
        expiresAt: "2026-08-02T03:05:00.000Z",
      };
    },
  },
  sandboxExecutor: new TrustedProcessSandboxExecutor(),
  resultLimits: {
    maximumContentBlocks: 4,
    maximumTextBytes: 128,
    maximumDetailsBytes: 128,
    maximumArtifactReferences: 2,
  },
  traceSink,
}));

const retryResult = await dispatcher.execute(invocation("retry-call", "RetryTool"), {
  signal: new AbortController().signal,
});
assert.equal(retryResult.content[0].text, "retried");
assert.equal(retryCalls, 2);

await assertToolError(
  dispatcher.execute(invocation("no-retry-call", "NoRetryTool"), {
    signal: new AbortController().signal,
  }),
  "TOOL_PARTIAL_FAILURE",
  "execution",
  "possible",
);
assert.equal(noRetryCalls, 1);

await assertToolError(
  dispatcher.execute(invocation("timeout-call", "TimeoutTool"), {
    signal: new AbortController().signal,
  }),
  "TOOL_EXECUTION_TIMED_OUT",
  "timeout",
  "none",
);

const cancelExecution = dispatcher.execute(invocation("cancel-call", "CancelTool"), {
  signal: new AbortController().signal,
});
await cancelStarted;
const firstCancel = dispatcher.cancel("cancel-call");
const secondCancel = dispatcher.cancel("cancel-call");
assert.equal((await firstCancel).outcome, TOOL_CANCEL_OUTCOME.cancelled);
assert.equal((await secondCancel).outcome, TOOL_CANCEL_OUTCOME.alreadyCancelled);
await assertToolError(
  cancelExecution,
  "TOOL_EXECUTION_CANCELLED",
  "cancelled",
  "possible",
);

const approvalExecution = dispatcher.execute(
  invocation("approval-call", "ApprovalTool"),
  { signal: new AbortController().signal },
);
const pending = await waitForPending(coordinator);
assert.equal(pending[0].approvalRequestId, "approval-approval-call");
assert.equal((await dispatcher.cancel("approval-call")).outcome, TOOL_CANCEL_OUTCOME.cancelled);
await assertToolError(
  approvalExecution,
  "TOOL_EXECUTION_CANCELLED",
  "cancelled",
  "none",
);
assert.equal((await dispatcher.cancel("missing-call")).outcome, TOOL_CANCEL_OUTCOME.notFound);

const traceSnapshots = eventSink.events
  .map((event) => event.getSnapshot())
  .filter((event) => event.eventType === "system.tool.trace.recorded");
assert.equal(traceSnapshots.length > 0, true);
const retryTrace = traceSnapshots.filter((event) => event.payload.toolCallId === "retry-call");
assert.equal(retryTrace.some((event) =>
  event.payload.stage === "execution_failed" && event.payload.attempt === 1), true);
assert.equal(retryTrace.some((event) =>
  event.payload.stage === "execution_completed" && event.payload.attempt === 2), true);
assert.equal(traceSnapshots.some((event) =>
  event.payload.stage === "timed_out" && event.payload.toolCallId === "timeout-call"), true);
assert.equal(traceSnapshots.some((event) =>
  event.payload.stage === "cancelled" && event.payload.toolCallId === "cancel-call"), true);
const registrySchemas = createCoreEventSchemaRegistry();
for (const snapshot of traceSnapshots) {
  assert.deepEqual(registrySchemas.validateOutput(snapshot), snapshot);
}
const serializedTrace = JSON.stringify(traceSnapshots);
for (const forbidden of [secret, "arguments", "content", "details", "path", "stack", "cause"]) {
  assert.equal(serializedTrace.includes(forbidden), false);
}
console.log("tool execution control smoke passed");

function tool(name, execute) {
  return defineTool({
    descriptor: {
      name,
      version: "1.0.0",
      label: name.replaceAll("_", " "),
      description: `Runs ${name}.`,
      parameters: Type.Object({ value: Type.Optional(Type.String()) }),
    },
    handler: { execute },
  });
}

function invocation(toolCallId, toolName) {
  return {
    conversationId: "conversation-control",
    runId: "run-control",
    turnId: "turn-control",
    toolCallId,
    toolName,
    arguments: { value: secret },
  };
}

function waitForAbort(signal, sideEffectStatus) {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(new ToolError({
      code: "TOOL_ABORT_OBSERVED",
      category: "execution",
      retryable: true,
      sideEffectStatus,
    }));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

async function waitForPending(coordinator) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const pending = await coordinator.listPending();
    if (pending.length > 0) return pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return coordinator.listPending();
}

async function assertToolError(promise, code, category, sideEffectStatus) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof ToolError, true);
    assert.equal(error.code, code);
    assert.equal(error.category, category);
    assert.equal(error.sideEffectStatus, sideEffectStatus);
    assert.equal(String(error).includes(secret), false);
    return true;
  });
}
