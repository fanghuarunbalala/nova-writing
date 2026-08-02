import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  CONVERSATION_RUNTIME_ACTIVATION_REASON,
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
  ManagedConversationHost,
} from "../dist/index.js";
import {
  NodeConversationProcessSupervisor,
  NodeRuntimeChildProcessLauncher,
  ParentRuntimeChildEndpointFactory,
} from "../dist/node/index.js";

const conversationId = "conversation-host-child";
const snapshot = createSnapshot(conversationId);
const outputs = [];
let runtimeOrdinal = 0;

const placement = new NodeConversationProcessSupervisor({
  launcher: new NodeRuntimeChildProcessLauncher({
    command: process.execPath,
    args: [fileURLToPath(new URL("./fixtures/runtime-child-entrypoint.mjs", import.meta.url))],
  }),
  endpointFactory: new ParentRuntimeChildEndpointFactory(),
});
const host = createHost(placement);
const activation = await host.ensureActive({
  conversationId,
  reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore,
});
assert.equal(activation.status, "activated");
assert.equal(activation.presence.state, "online");
await host.notifyAccepted({
  conversationId,
  inputEventId: "input-host-child",
  eventType: "user.message",
  priority: 0,
  sequence: 8,
  recordedAt: "2026-08-02T00:00:01.000Z",
  journalStatus: "appended",
  route: { target: "runtime", activation: "required" },
});
await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal((await host.getRuntimePresence(conversationId)).state, "online");
const shutdown = await host.shutdownRuntime({
  conversationId,
  reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown,
});
assert.equal(shutdown.status, "stopped");
assert.equal(shutdown.presence.state, "offline");
await host.close();
await placement.close();

const crashPlacement = new NodeConversationProcessSupervisor({
  launcher: new NodeRuntimeChildProcessLauncher({
    command: process.execPath,
    args: [fileURLToPath(new URL("./fixtures/runtime-child-crash.mjs", import.meta.url))],
  }),
  endpointFactory: new ParentRuntimeChildEndpointFactory(),
});
const crashHost = createHost(crashPlacement);
await crashHost.ensureActive({
  conversationId,
  reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.crashRecovery,
});
await new Promise((resolve) => setTimeout(resolve, 500));
assert.equal((await crashHost.getRuntimePresence(conversationId)).state, "crashed");
assert.equal(crashPlacement.activeProcessCount, 0);
await crashHost.close();
await crashPlacement.close();

console.log("Runtime Host-to-child integration smoke passed");

function createHost(runtimePlacement) {
  return new ManagedConversationHost({
    snapshotReader: { async getSnapshot() { return snapshot; } },
    bootstrapFactory: {
      async create(request) {
        return {
          schemaVersion: 1,
          runtimeInstanceId: request.runtimeInstanceId,
          activatedAt: request.activatedAt,
          conversation: snapshot,
          workspace: { workspaceId: snapshot.metadata.workspaceId, workdir: "/private/host-child-workdir" },
          activation: request.activation,
          journal: { highWatermark: 8 },
        };
      },
    },
    placement: runtimePlacement,
    controlDispatcher: { async dispatch() { throw new Error("Unexpected control dispatch"); } },
    outputPublisher: {
      async publish(event) {
        const value = event.getSnapshot();
        outputs.push(value);
        return { status: "recorded", conversationId, outputEventId: value.id, sequence: outputs.length, recordedAt: value.timestamp };
      },
    },
    clock: { now: () => `2026-08-02T00:00:0${Math.min(runtimeOrdinal + 1, 9)}.000Z` },
    runtimeInstanceIdGenerator: { generate() { runtimeOrdinal += 1; return `rt_${runtimeOrdinal.toString(16).padStart(32, "0")}`; } },
  });
}

function createSnapshot(id) {
  return {
    metadata: { id, workspaceId: "workspace-host-child", rootConversationId: id, status: "active", lastJournalSequence: 7, createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z" },
    activeAgentBinding: { id: "binding-host-child", conversationId: id, revision: 1, agentType: "novel.main", definitionVersion: "1.0.0", status: "active", createdAt: "2026-08-02T00:00:00.000Z" },
  };
}
