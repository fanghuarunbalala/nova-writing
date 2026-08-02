import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
  createInMemoryRuntimeIpcConnectionPair,
} from "../dist/index.js";
import {
  NodeConversationProcessSupervisor,
  NodeRuntimeChildProcessLauncher,
  ParentRuntimeChildEndpointFactory,
  ParentRuntimeChildHandshakeError,
  RuntimeChildPayloadError,
  RuntimeProcessExitNormalizer,
  captureRuntimeChildBootstrap,
  captureRuntimeChildInput,
} from "../dist/node/index.js";

class CollectingLogger {
  constructor(entries = [], bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }
  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }
  child(bindings) {
    return new CollectingLogger(this.entries, { ...this.bindings, ...bindings });
  }
  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

const privateWorkdir = "/private/runtime-child-workdir/DO_NOT_LOG";
const bootstrap = createBootstrap(privateWorkdir);
const capturedBootstrap = captureRuntimeChildBootstrap(bootstrap);
assert.equal(Object.isFrozen(capturedBootstrap), true);
assert.equal(Object.isFrozen(capturedBootstrap.conversation.metadata), true);
bootstrap.conversation.metadata.updatedAt = "2026-08-02T23:59:59.000Z";
assert.equal(capturedBootstrap.conversation.metadata.updatedAt, "2026-08-02T00:00:00.000Z");
assert.throws(
  () => captureRuntimeChildBootstrap({ ...bootstrap, unknown: true }),
  RuntimeChildPayloadError,
);
assert.throws(
  () => captureRuntimeChildInput({
    conversationId: "conversation-child",
    inputEventId: "input-child",
    eventType: "not valid",
    sequence: 1,
  }),
  (error) =>
    error instanceof RuntimeChildPayloadError && error.payloadKind === "input",
);

const logs = [];
const logger = new CollectingLogger(logs);
const fixturePath = fileURLToPath(
  new URL("./fixtures/runtime-child-entrypoint.mjs", import.meta.url),
);
const supervisor = new NodeConversationProcessSupervisor({
  launcher: new NodeRuntimeChildProcessLauncher({
    command: process.execPath,
    args: [fixturePath],
    logger,
  }),
  endpointFactory: new ParentRuntimeChildEndpointFactory({ logger }),
  exitNormalizer: new RuntimeProcessExitNormalizer({
    clock: { now: () => "2026-08-02T00:00:03.000Z" },
  }),
  logger,
});

const handle = await supervisor.activate(createBootstrap(privateWorkdir));
await handle.dispatchInput({
  conversationId: "conversation-child",
  inputEventId: "input-child",
  eventType: "user.message",
  sequence: 8,
});
await handle.shutdown({
  reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown,
});
assert.deepEqual(await withTimeout(handle.waitForExit()), {
  kind: "stopped",
  exitedAt: "2026-08-02T00:00:03.000Z",
  reason: "explicit_shutdown",
});
await supervisor.close();

const incompatible = createInMemoryRuntimeIpcConnectionPair();
const incompatibleFactory = new ParentRuntimeChildEndpointFactory({
  sessionIdFactory: { create: () => "session-incompatible" },
});
const rejected = incompatibleFactory.connect({
  bootstrap: createBootstrap(privateWorkdir),
  connection: incompatible.first,
});
await incompatible.second.send({
  frameType: "hello",
  protocolFamily: "novel.runtime.ipc",
  supportedProtocol: { minimumVersion: 2, maximumVersion: 2 },
  processNonce: "process-incompatible",
});
assert.equal((await incompatible.second.next()).value.frameType, "rejected");
await assert.rejects(
  rejected,
  (error) =>
    error instanceof ParentRuntimeChildHandshakeError &&
    error.failure === "unsupported_protocol",
);

const serializedLogs = JSON.stringify(logs);
assert.equal(serializedLogs.includes(privateWorkdir), false);
assert.equal(serializedLogs.includes(fixturePath), false);
for (const forbidden of [
  "payload",
  "message",
  "stack",
  "cause",
  "stderr",
  "workdir",
  "path",
  "credential",
]) {
  assert.equal(logs.some((entry) => Object.hasOwn(entry.fields, forbidden)), false);
}

console.log("Runtime child entrypoint smoke passed");

function createBootstrap(workdir) {
  return {
    schemaVersion: 1,
    runtimeInstanceId: "runtime-child",
    activatedAt: "2026-08-02T00:00:01.000Z",
    conversation: {
      metadata: {
        id: "conversation-child",
        workspaceId: "workspace-child",
        rootConversationId: "conversation-child",
        status: "active",
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        lastJournalSequence: 7,
      },
      activeAgentBinding: {
        id: "binding-child",
        conversationId: "conversation-child",
        revision: 1,
        agentType: "novel.main",
        definitionVersion: "1.0.0",
        status: "active",
        createdAt: "2026-08-02T00:00:00.000Z",
      },
    },
    workspace: {
      workspaceId: "workspace-child",
      workdir,
    },
    activation: { reason: "explicit_restore" },
    journal: { highWatermark: 7 },
  };
}

function withTimeout(promise, timeoutMs = 3_000) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("Timed out waiting for child exit")),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
