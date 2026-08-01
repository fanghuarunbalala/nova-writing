import assert from "node:assert/strict";
import {
  CONVERSATION_RUNTIME_ACTIVATION_REASON,
  CONVERSATION_RUNTIME_ACTIVATION_STATUS,
  CONVERSATION_RUNTIME_BOOTSTRAP_SCHEMA_VERSION,
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
  CONVERSATION_RUNTIME_SHUTDOWN_STATUS,
  ConversationHostClosedError,
  ConversationHostClosingError,
  ConversationRuntimeActivationError,
  ConversationRuntimeDispatchError,
  ConversationRuntimeHandleMismatchError,
  RUNTIME_PRESENCE_STATE,
} from "../dist/index.js";

class FakeRuntimeHandle {
  constructor(conversationId, runtimeInstanceId) {
    this.conversationId = conversationId;
    this.runtimeInstanceId = runtimeInstanceId;
    this.inputs = [];
    this.shutdownRequests = [];
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  async dispatchInput(input) {
    assert.equal(input.conversationId, this.conversationId);
    this.inputs.push(Object.freeze({ ...input }));
  }

  async shutdown(request) {
    this.shutdownRequests.push(Object.freeze({ ...request }));
    if (this.shutdownRequests.length === 1) {
      this.resolveExit(
        Object.freeze({
          kind: "stopped",
          exitedAt: "2026-08-01T00:00:03.000Z",
          reason: request.reason,
        }),
      );
    }
  }

  waitForExit() {
    return this.exitPromise;
  }
}

class FakeRuntimePlacement {
  constructor() {
    this.bootstraps = [];
  }

  async activate(bootstrap) {
    this.bootstraps.push(bootstrap);
    return new FakeRuntimeHandle(
      bootstrap.conversation.metadata.id,
      bootstrap.runtimeInstanceId,
    );
  }
}

class FakeBootstrapFactory {
  constructor(snapshot) {
    this.snapshot = snapshot;
  }

  async create(request) {
    return Object.freeze({
      schemaVersion: CONVERSATION_RUNTIME_BOOTSTRAP_SCHEMA_VERSION,
      runtimeInstanceId: request.runtimeInstanceId,
      activatedAt: request.activatedAt,
      conversation: this.snapshot,
      workspace: Object.freeze({
        workspaceId: this.snapshot.metadata.workspaceId,
        workdir: "/workspace/novel",
      }),
      activation: request.activation,
      journal: Object.freeze({ highWatermark: 41 }),
    });
  }
}

const snapshot = Object.freeze({
  metadata: Object.freeze({
    id: "conversation-host-protocol",
    workspaceId: "workspace-host-protocol",
    rootConversationId: "conversation-host-protocol",
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    lastJournalSequence: 41,
  }),
  activeAgentBinding: Object.freeze({
    id: "binding-host-protocol",
    conversationId: "conversation-host-protocol",
    revision: 1,
    agentType: "novel.main",
    definitionVersion: "1",
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
  }),
});

const inputReference = Object.freeze({
  conversationId: "conversation-host-protocol",
  inputEventId: "input-host-protocol",
  eventType: "user.message",
  sequence: 41,
  correlationId: "correlation-host-protocol",
});

const acceptedInputActivation = Object.freeze({
  conversationId: "conversation-host-protocol",
  reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.acceptedInput,
  input: inputReference,
});
const restoreActivation = Object.freeze({
  conversationId: "conversation-host-protocol",
  reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore,
});

assert.deepEqual(Object.values(CONVERSATION_RUNTIME_ACTIVATION_REASON), [
  "accepted_input",
  "explicit_restore",
  "crash_recovery",
]);
assert.deepEqual(Object.values(CONVERSATION_RUNTIME_ACTIVATION_STATUS), [
  "activated",
  "reused",
]);
assert.deepEqual(Object.values(CONVERSATION_RUNTIME_SHUTDOWN_REASON), [
  "explicit_shutdown",
  "host_close",
  "idle_eviction",
  "replacement",
]);
assert.deepEqual(Object.values(CONVERSATION_RUNTIME_SHUTDOWN_STATUS), [
  "stopped",
  "already_offline",
]);
assert.equal(acceptedInputActivation.input.sequence, 41);
assert.equal(Object.hasOwn(restoreActivation, "input"), false);

const factory = new FakeBootstrapFactory(snapshot);
const bootstrap = await factory.create({
  conversationId: "conversation-host-protocol",
  runtimeInstanceId: "runtime-instance-1",
  activatedAt: "2026-08-01T00:00:01.000Z",
  activation: {
    reason: acceptedInputActivation.reason,
    input: acceptedInputActivation.input,
  },
});

assert.equal(bootstrap.schemaVersion, 1);
assert.equal(bootstrap.conversation.activeAgentBinding.agentType, "novel.main");
assert.equal(bootstrap.workspace.workspaceId, "workspace-host-protocol");
assert.equal(bootstrap.workspace.workdir, "/workspace/novel");
assert.equal(bootstrap.journal.highWatermark, 41);
for (const forbidden of [
  "storeDir",
  "storeDirName",
  "databasePath",
  "providerCredential",
  "apiKey",
  "systemPrompt",
  "toolHandler",
  "pid",
  "ipcAddress",
]) {
  assert.equal(JSON.stringify(bootstrap).includes(forbidden), false);
}

const placement = new FakeRuntimePlacement();
const handle = await placement.activate(bootstrap);
assert.equal(handle.conversationId, "conversation-host-protocol");
assert.equal(handle.runtimeInstanceId, "runtime-instance-1");
await handle.dispatchInput(inputReference);
assert.deepEqual(handle.inputs, [inputReference]);

const firstExitPromise = handle.waitForExit();
assert.equal(handle.waitForExit(), firstExitPromise);
await handle.shutdown({ reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.hostClose });
await handle.shutdown({ reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.hostClose });
const exit = await firstExitPromise;
assert.deepEqual(exit, {
  kind: "stopped",
  exitedAt: "2026-08-01T00:00:03.000Z",
  reason: "host_close",
});
assert.equal(handle.shutdownRequests.length, 2);
for (const forbidden of ["message", "stack", "cause", "stderr"] ) {
  assert.equal(Object.hasOwn(exit, forbidden), false);
}

const crashedExit = Object.freeze({
  kind: "crashed",
  exitedAt: "2026-08-01T00:00:04.000Z",
  errorName: "ProviderUnavailableError",
  errorCode: "PROVIDER_UNAVAILABLE",
});
for (const forbidden of ["message", "stack", "cause", "stderr"] ) {
  assert.equal(Object.hasOwn(crashedExit, forbidden), false);
}

const errors = [
  new ConversationHostClosingError(),
  new ConversationHostClosedError(),
  new ConversationRuntimeActivationError(
    "conversation-host-protocol",
    "ActivationFailure",
    "ACTIVATION_FAILED",
  ),
  new ConversationRuntimeHandleMismatchError(
    "conversation-host-protocol",
    "wrong-conversation",
    "runtime-instance-1",
    "wrong-runtime-instance",
  ),
  new ConversationRuntimeDispatchError(
    "conversation-host-protocol",
    41,
    "DispatchFailure",
    "DISPATCH_FAILED",
  ),
];
assert.deepEqual(
  errors.map((error) => error.code),
  [
    "CONVERSATION_HOST_CLOSING",
    "CONVERSATION_HOST_CLOSED",
    "CONVERSATION_RUNTIME_ACTIVATION_FAILED",
    "CONVERSATION_RUNTIME_HANDLE_MISMATCH",
    "CONVERSATION_RUNTIME_DISPATCH_FAILED",
  ],
);
for (const error of errors) {
  assert.equal(Object.hasOwn(error, "cause"), false);
  assert.equal(Object.hasOwn(error, "stackTrace"), false);
}

const fakeHost = {
  notifyAccepted: async () => undefined,
  getRuntimePresence: async () => ({
    state: RUNTIME_PRESENCE_STATE.offline,
    observedAt: "2026-08-01T00:00:00.000Z",
  }),
  ensureActive: async () => ({
    status: CONVERSATION_RUNTIME_ACTIVATION_STATUS.activated,
    presence: {
      state: RUNTIME_PRESENCE_STATE.online,
      observedAt: "2026-08-01T00:00:02.000Z",
    },
  }),
  shutdownRuntime: async () => ({
    status: CONVERSATION_RUNTIME_SHUTDOWN_STATUS.stopped,
    presence: {
      state: RUNTIME_PRESENCE_STATE.offline,
      observedAt: "2026-08-01T00:00:03.000Z",
    },
  }),
  close: async () => undefined,
};

await fakeHost.notifyAccepted({});
assert.equal((await fakeHost.getRuntimePresence()).state, "offline");
assert.equal((await fakeHost.ensureActive(acceptedInputActivation)).status, "activated");
assert.equal(
  (
    await fakeHost.shutdownRuntime({
      conversationId: "conversation-host-protocol",
      reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown,
    })
  ).status,
  "stopped",
);
await fakeHost.close();

console.log("Task 2D-A Conversation Host protocol smoke passed");
