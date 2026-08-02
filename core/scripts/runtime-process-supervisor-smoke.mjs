import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
} from "../dist/index.js";
import {
  NodeConversationProcessConflictError,
  NodeConversationProcessActivationError,
  NodeConversationProcessSupervisor,
  NodeConversationProcessSupervisorClosedError,
  NodeRuntimeChildProcessLauncher,
  RuntimeChildProcessLaunchError,
  RuntimeProcessExitNormalizer,
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

class CapturingEndpointFactory {
  constructor() {
    this.endpoints = new Map();
  }
  async connect({ bootstrap, connection }) {
    const endpoint = new CapturingEndpoint(connection);
    this.endpoints.set(bootstrap.runtimeInstanceId, endpoint);
    return endpoint;
  }
}

class CapturingEndpoint {
  constructor(connection) {
    this.connection = connection;
    this.inputs = [];
    this.shutdowns = [];
  }
  async dispatchInput(input) {
    this.inputs.push(input);
  }
  async shutdown(request) {
    this.shutdowns.push(request);
    await this.connection.close();
  }
  close() {
    return this.connection.close();
  }
}

const privateStderr = "DO_NOT_CAPTURE_RUNTIME_CHILD_STDERR";
const fixturePath = fileURLToPath(
  new URL("./fixtures/runtime-child-process-idle.mjs", import.meta.url),
);
const logs = [];
const logger = new CollectingLogger(logs);
const endpointFactory = new CapturingEndpointFactory();
const launcher = new NodeRuntimeChildProcessLauncher({
  command: process.execPath,
  args: [fixturePath],
  logger,
});
const supervisor = new NodeConversationProcessSupervisor({
  launcher,
  endpointFactory,
  exitNormalizer: new RuntimeProcessExitNormalizer({
    clock: { now: () => "2026-08-02T00:00:00.000Z" },
  }),
  logger,
});

const bootstrap = createBootstrap("conversation-process-1", "runtime-process-1");
const handle = await supervisor.activate(bootstrap);
assert.equal(supervisor.activeProcessCount, 1);
assert.equal(handle.conversationId, "conversation-process-1");
assert.equal(handle.runtimeInstanceId, "runtime-process-1");
assert.equal(handle.waitForExit(), handle.waitForExit());

const second = await supervisor.activate(
  createBootstrap("conversation-process-2", "runtime-process-2"),
);
assert.equal(supervisor.activeProcessCount, 2);

await assert.rejects(
  supervisor.activate(createBootstrap("conversation-process-1", "runtime-process-3")),
  NodeConversationProcessConflictError,
);
await assert.rejects(
  supervisor.activate(createBootstrap("conversation-process-3", "runtime-process-2")),
  NodeConversationProcessConflictError,
);

const input = Object.freeze({
  conversationId: "conversation-process-1",
  inputEventId: "input-process-1",
  eventType: "user.message",
  sequence: 7,
});
await handle.dispatchInput(input);
assert.deepEqual(endpointFactory.endpoints.get("runtime-process-1").inputs, [input]);

await handle.shutdown({
  reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown,
});
const exit = await withTimeout(handle.waitForExit());
assert.deepEqual(exit, {
  kind: "stopped",
  exitedAt: "2026-08-02T00:00:00.000Z",
  reason: "explicit_shutdown",
});
await waitFor(() => supervisor.activeProcessCount === 1);
assert.equal(supervisor.activeProcessCount, 1);
await supervisor.close();
await supervisor.close();
assert.deepEqual(await withTimeout(second.waitForExit()), {
  kind: "stopped",
  exitedAt: "2026-08-02T00:00:00.000Z",
  reason: "host_close",
});
await assert.rejects(
  supervisor.activate(createBootstrap("conversation-process-3", "runtime-process-3")),
  NodeConversationProcessSupervisorClosedError,
);

const privateEndpointError = "DO_NOT_LOG_ENDPOINT_CONNECT_FAILURE";
const failingSupervisor = new NodeConversationProcessSupervisor({
  launcher,
  endpointFactory: {
    async connect() { throw new Error(privateEndpointError); },
  },
  logger,
});
await assert.rejects(
  failingSupervisor.activate(
    createBootstrap("conversation-connect-failure", "runtime-connect-failure"),
  ),
  (error) =>
    error instanceof NodeConversationProcessActivationError &&
    error.stage === "connect",
);
assert.equal(failingSupervisor.activeProcessCount, 0);
await failingSupervisor.close();

const normalizer = new RuntimeProcessExitNormalizer({
  clock: { now: () => "2026-08-02T00:00:01.000Z" },
});
assert.deepEqual(normalizer.normalize({ kind: "exited", code: 0, signal: null }), {
  kind: "crashed",
  exitedAt: "2026-08-02T00:00:01.000Z",
  errorName: "RuntimeChildProcessExitError",
  errorCode: "RUNTIME_CHILD_PROCESS_UNEXPECTED_EXIT",
});
assert.deepEqual(normalizer.normalize({ kind: "exited", code: 9, signal: null }), {
  kind: "crashed",
  exitedAt: "2026-08-02T00:00:01.000Z",
  errorName: "RuntimeChildProcessExitError",
  errorCode: "RUNTIME_CHILD_PROCESS_NON_ZERO_EXIT",
});
assert.deepEqual(normalizer.normalize({ kind: "exited", code: null, signal: "SIGKILL" }), {
  kind: "crashed",
  exitedAt: "2026-08-02T00:00:01.000Z",
  errorName: "RuntimeChildProcessExitError",
  errorCode: "RUNTIME_CHILD_PROCESS_SIGNAL_EXIT",
});
assert.deepEqual(normalizer.normalize({
  kind: "failed",
  errorName: "SpawnFailure",
  errorCode: "SPAWN_FAILED",
}), {
  kind: "crashed",
  exitedAt: "2026-08-02T00:00:01.000Z",
  errorName: "SpawnFailure",
  errorCode: "SPAWN_FAILED",
});

const missingCommand = `${fixturePath}.missing-${Date.now()}`;
const failingLauncher = new NodeRuntimeChildProcessLauncher({
  command: missingCommand,
  logger,
});
await assert.rejects(
  failingLauncher.launch({
    conversationId: "conversation-launch-failure",
    runtimeInstanceId: "runtime-launch-failure",
  }),
  RuntimeChildProcessLaunchError,
);

const serializedLogs = JSON.stringify(logs);
assert.equal(serializedLogs.includes(privateStderr), false);
assert.equal(serializedLogs.includes(privateEndpointError), false);
assert.equal(serializedLogs.includes(fixturePath), false);
assert.equal(serializedLogs.includes(missingCommand), false);
for (const forbidden of ["message", "stack", "cause", "stderr", "workdir", "path"]) {
  assert.equal(logs.some((entry) => Object.hasOwn(entry.fields, forbidden)), false);
}

console.log("Runtime child-process supervisor smoke passed");

function createBootstrap(conversationId, runtimeInstanceId) {
  return Object.freeze({
    schemaVersion: 1,
    runtimeInstanceId,
    activatedAt: "2026-08-02T00:00:00.000Z",
    conversation: Object.freeze({
      metadata: Object.freeze({ id: conversationId }),
    }),
    workspace: Object.freeze({
      workspaceId: "workspace-process",
      workdir: "/private/workspace/never-log",
    }),
    activation: Object.freeze({ reason: "explicit_restore" }),
    journal: Object.freeze({ highWatermark: 0 }),
  });
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for process state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function withTimeout(promise, timeoutMs = 2_000) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("Timed out waiting for process exit")),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
