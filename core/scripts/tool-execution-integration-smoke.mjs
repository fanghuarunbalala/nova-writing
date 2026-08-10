import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import {
  ApprovalDecisionInputEvent,
  InMemoryInteractionCoordinator,
  LayeredToolPermissionPolicy,
  RuntimeEventToolTraceSink,
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
import { NodeSha256ToolArgumentDigester } from "../dist/node/index.js";
import { DispatcherPiToolExecutionBridge } from "../dist/runtime/agent/pi/DispatcherPiToolExecutionBridge.js";
import { PiToolAdapter } from "../dist/runtime/agent/pi/PiToolAdapter.js";

class CollectingEventSink {
  constructor() { this.events = []; }

  async append(event) {
    this.events.push(event);
    return Object.freeze({
      status: "recorded",
      conversationId: event.conversationId,
      eventId: event.id,
      sequence: this.events.length,
      recordedAt: event.timestamp,
    });
  }
}

const privateArguments = "DO_NOT_PERSIST_PI_TOOL_ARGUMENTS";
let writeExecutions = 0;
let cancellationStartedResolve;
const cancellationStarted = new Promise((resolve) => {
  cancellationStartedResolve = resolve;
});
const writeTool = defineTool({
  descriptor: {
    name: "WriteChapter",
    version: "1.2.3",
    label: "Write chapter",
    description: "Writes one chapter draft.",
    parameters: Type.Object({ text: Type.String() }),
  },
  handler: {
    async execute(_context, arguments_, progress) {
      writeExecutions += 1;
      await progress.emit({ kind: "progress", completed: 1, total: 1 });
      return {
        content: [{ type: "text", text: "chapter written" }],
        details: { acceptedCharacters: arguments_.text.length },
      };
    },
  },
});
const cancellationTool = defineTool({
  descriptor: {
    name: "WaitForSignal",
    version: "1.0.0",
    label: "Wait for signal",
    description: "Waits until the caller cancels execution.",
    parameters: Type.Object({}),
  },
  handler: {
    async execute(context) {
      cancellationStartedResolve();
      return new Promise((_resolve, reject) => {
        const rejectCancelled = () => reject(new ToolError({
          code: "TOOL_CANCELLED_BY_HANDLER",
          category: "cancelled",
          retryable: false,
          sideEffectStatus: "none",
        }));
        if (context.signal.aborted) {
          rejectCancelled();
          return;
        }
        context.signal.addEventListener("abort", rejectCancelled, { once: true });
      });
    },
  },
});
const assembler = new ToolRegistryAssembler();
assembler.register(writeTool).register(cancellationTool);
const registry = assembler.freeze();
const groups = new ToolGroupCatalog([{
  schemaVersion: TOOL_GROUP_MANIFEST_SCHEMA_VERSION,
  id: "checkpoint_5b",
  version: "1.0.0",
  label: "Checkpoint 5B tools",
  tools: ["WriteChapter", "WaitForSignal"],
}]);
const registryView = new ToolRegistryView({
  registry,
  groups,
  policy: { groupIds: ["checkpoint_5b"] },
});
const executionPolicy = {
  timeoutMs: 5_000,
  isolation: "trusted_process",
  cancellable: true,
  idempotent: false,
  restartable: false,
  checkpointable: false,
  retry: { maximumAttempts: 1 },
};
const executionPolicyResolver = new StaticToolExecutionPolicyResolver(
  registryView.listAllowed().map((tool) => ({
    toolName: tool.descriptor.name,
    toolVersion: tool.descriptor.version,
    policy: executionPolicy,
  })),
);
const permissionPolicy = new LayeredToolPermissionPolicy([
  {
    ruleId: "workspace.ask_write_chapter",
    source: "workspace",
    effect: "ask",
    match: { toolNames: ["WriteChapter"] },
  },
  {
    ruleId: "workspace.allow_wait_for_signal",
    source: "workspace",
    effect: "allow",
    match: { toolNames: ["WaitForSignal"] },
  },
]);
const eventSink = new CollectingEventSink();
const interactionCoordinator = new InMemoryInteractionCoordinator({ eventSink });
const argumentDigester = new NodeSha256ToolArgumentDigester();
const dispatcher = new ToolDispatcher(new ToolExecutionPipeline({
  registryView,
  runtimeInstanceId: "runtime-instance-smoke",
  argumentDigester,
  executionPolicyResolver,
  permissionPolicy,
  interactionCoordinator,
  approvalRequestFactory: {
    create(input) {
      return {
        approvalRequestId: `approval-${input.identity.toolCallId}`,
        identity: input.identity,
        runtimeInstanceId: input.runtimeInstanceId,
        ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
        summary: { title: input.toolLabel, description: input.toolDescription },
        requestedAt: "2026-08-02T04:00:00.000Z",
        expiresAt: "2026-08-02T04:05:00.000Z",
      };
    },
  },
  sandboxExecutor: new TrustedProcessSandboxExecutor(),
  resultLimits: {
    maximumContentBlocks: 4,
    maximumTextBytes: 256,
    maximumDetailsBytes: 256,
    maximumArtifactReferences: 2,
  },
  traceSink: new RuntimeEventToolTraceSink({ eventSink }),
}));
const bridge = new DispatcherPiToolExecutionBridge({
  dispatcher,
  conversationId: "conversation-checkpoint-5b",
  runId: "run-checkpoint-5b",
  turnId: "turn-checkpoint-5b",
});
const adapter = new PiToolAdapter(bridge);
const piWriteTool = adapter.toAgentTool(writeTool);
const updates = [];
const writePromise = piWriteTool.execute(
  "tool-call-write",
  { text: privateArguments },
  new AbortController().signal,
  (update) => updates.push(update),
);

const pending = await waitForPending(interactionCoordinator);
assert.equal(pending.length, 1);
assert.equal(writeExecutions, 0);
assert.equal(pending[0].identity.toolVersion, "1.2.3");
const expectedDigest = `sha256:${createHash("sha256")
  .update(JSON.stringify({ text: privateArguments }), "utf8")
  .digest("hex")}`;
assert.equal(pending[0].identity.argumentDigest, expectedDigest);
assert.notEqual(
  await argumentDigester.digest({ text: `${privateArguments}-changed` }),
  expectedDigest,
);
assert.equal(JSON.stringify(eventSink.events).includes(privateArguments), false);

await interactionCoordinator.resolve(
  persistedApprovalDecision(pending[0], 1),
  { actorId: "local_user" },
);
const writeResult = await writePromise;
assert.equal(writeExecutions, 1);
assert.deepEqual(updates, [{
  content: [],
  details: { kind: "progress", completed: 1, total: 1 },
}]);
assert.deepEqual(writeResult, {
  content: [{ type: "text", text: "chapter written" }],
  details: {
    kind: "result",
    details: { acceptedCharacters: privateArguments.length },
  },
});

const staleTool = defineTool({
  descriptor: {
    ...writeTool.descriptor,
    version: "9.9.9",
  },
  handler: writeTool.handler,
});
await assert.rejects(
  adapter.toAgentTool(staleTool).execute("tool-call-stale", { text: "stale" }),
  (error) => error instanceof ToolError && error.code === "TOOL_VERSION_MISMATCH",
);
assert.equal(writeExecutions, 1);

const cancellationController = new AbortController();
const cancellationPromise = adapter.toAgentTool(cancellationTool).execute(
  "tool-call-cancel",
  {},
  cancellationController.signal,
);
await cancellationStarted;
cancellationController.abort();
await assert.rejects(
  cancellationPromise,
  (error) => error instanceof ToolError && error.category === "cancelled",
);

const snapshots = eventSink.events.map((event) => event.getSnapshot());
const eventTypes = snapshots.map((event) => event.eventType);
assert.equal(eventTypes.includes("system.tool.approval.requested"), true);
assert.equal(eventTypes.includes("system.tool.approval.resolved"), true);
assert.equal(eventTypes.includes("system.tool.trace.recorded"), true);
const traceStages = snapshots
  .filter((event) => event.eventType === "system.tool.trace.recorded")
  .map((event) => event.payload.stage);
for (const stage of [
  "received",
  "resolved",
  "validated",
  "permission_evaluated",
  "approval_requested",
  "approval_resolved",
  "sandbox_started",
  "execution_started",
  "execution_completed",
  "cancelled",
]) {
  assert.equal(traceStages.includes(stage), true, `missing Trace stage ${stage}`);
}
const serializedEvents = JSON.stringify(snapshots);
assert.equal(serializedEvents.includes(privateArguments), false);
assert.equal(serializedEvents.includes("payload"), true);
assert.equal(serializedEvents.includes("arguments"), false);

for (const declarationPath of [
  "index.d.ts",
  "tools/index.d.ts",
  "runtime/index.d.ts",
  "runtime/agent/index.d.ts",
  "runtime/agent/pi/index.d.ts",
]) {
  const declaration = await readFile(join(process.cwd(), "dist", declarationPath), "utf8");
  for (const forbidden of [
    "@earendil-works/pi-agent-core",
    "PiToolAdapter",
    "PiToolExecutionBridge",
    "DispatcherPiToolExecutionBridge",
    "AgentTool",
    "AgentToolResult",
  ]) {
    assert.equal(
      declaration.includes(forbidden),
      false,
      `${forbidden} leaked through ${declarationPath}`,
    );
  }
}

console.log("Tool execution Checkpoint 5B integration smoke passed");

function persistedApprovalDecision(request, sequence) {
  const event = new ApprovalDecisionInputEvent({
    id: `input-${request.approvalRequestId}`,
    conversationId: request.identity.conversationId,
    runId: request.identity.runId,
    turnId: request.turnId,
    timestamp: "2026-08-02T04:00:01.000Z",
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

async function waitForPending(coordinator) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pendingRequests = await coordinator.listPending();
    if (pendingRequests.length > 0) return pendingRequests;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return coordinator.listPending();
}
