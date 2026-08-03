import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ApiTransportDisconnectedError,
  ApiTransportError,
  DefaultNovelApiClient,
  UserMessageInputEvent,
} from "../../core/dist/index.js";
import { DesktopApiIpcController } from "../dist/main/index.js";
import {
  createElectronPreloadBridge,
  exposeDesktopApi,
} from "../dist/preload/index.js";
import { ElectronApiTransport } from "../dist/renderer/index.js";
import {
  ELECTRON_API_IPC_CHANNEL,
  ELECTRON_API_IPC_CHANNELS,
  ELECTRON_APPLICATION_COMMAND_CHANNEL,
  NOVEL_DESKTOP_BRIDGE_KEY,
} from "../dist/shared/index.js";

class FakeIpcMain {
  handlers = new Map();

  handle(channel, handler) {
    if (this.handlers.has(channel)) throw new Error("duplicate channel");
    this.handlers.set(channel, handler);
  }

  removeHandler(channel) {
    this.handlers.delete(channel);
  }

  async invoke(senderId, channel, ...args) {
    const handler = this.handlers.get(channel);
    if (handler === undefined) throw new Error("missing IPC handler");
    const result = await handler(
      { sender: { id: senderId } },
      ...jsonRoundTrip(args),
    );
    return jsonRoundTrip(result);
  }
}

class FakeIpcRenderer {
  listeners = new Map();

  constructor(ipcMain, senderId) {
    this.ipcMain = ipcMain;
    this.senderId = senderId;
  }

  invoke(channel, ...args) {
    return this.ipcMain.invoke(this.senderId, channel, ...args);
  }

  on(channel, listener) {
    const listeners = this.listeners.get(channel) ?? new Set();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
  }

  removeListener(channel, listener) {
    this.listeners.get(channel)?.delete(listener);
  }

  emit(channel, value) {
    for (const listener of this.listeners.get(channel) ?? []) {
      listener({}, value);
    }
  }
}

class FakeContextBridge {
  exposures = new Map();

  exposeInMainWorld(key, api) {
    if (this.exposures.has(key)) throw new Error("duplicate exposure");
    this.exposures.set(key, api);
  }
}

class TestHostTransport {
  requests = [];
  subscriptions = [];
  abortedRequestIds = [];
  closedSubscriptionIds = [];
  pendingRequestIds = new Set();
  privateError = "private-host-transport-error";

  async request(request, options) {
    this.requests.push(request);
    if (request.operation === "test.pending") {
      this.pendingRequestIds.add(request.requestId);
      return new Promise((_resolve, reject) => {
        const abort = () => {
          this.pendingRequestIds.delete(request.requestId);
          this.abortedRequestIds.push(request.requestId);
          reject(options?.signal?.reason ?? new DOMException("aborted", "AbortError"));
        };
        if (options?.signal?.aborted) abort();
        else options?.signal?.addEventListener("abort", abort, { once: true });
      });
    }
    if (request.operation === "test.throw") {
      throw new Error(this.privateError);
    }
    const conversationId = request.payload?.conversationId;
    if (request.operation === "conversation.snapshot.get") {
      return successResponse(
        request.requestId,
        createConversationSnapshot(conversationId),
      );
    }
    return successResponse(request.requestId, { accepted: true });
  }

  subscribe(request) {
    const conversationId = request.payload?.conversationId ?? "conversation-owner";
    const subscription = new TestHostSubscription({
      id: `host:${request.requestId}`,
      frames: [createInputFrame(`host:${request.requestId}`, conversationId, 1)],
      onClose: (subscriptionId) => this.closedSubscriptionIds.push(subscriptionId),
    });
    this.subscriptions.push(subscription);
    return subscription;
  }
}

class TestHostSubscription {
  constructor(options) {
    this.id = options.id;
    this.frames = [...options.frames];
    this.onClose = options.onClose;
  }

  closed = false;
  closePromise;

  async next() {
    if (this.closed) return { done: true, value: undefined };
    const frame = this.frames.shift();
    return frame === undefined
      ? { done: true, value: undefined }
      : { done: false, value: frame };
  }

  async return() {
    await this.close();
    return { done: true, value: undefined };
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  close() {
    this.closePromise ??= Promise.resolve().then(() => {
      if (this.closed) return;
      this.closed = true;
      this.onClose(this.id);
    });
    return this.closePromise;
  }
}

const logs = [];
const ipcMain = new FakeIpcMain();
const hostTransport = new TestHostTransport();
const controller = new DesktopApiIpcController({
  transport: hostTransport,
  authorizeSender: (senderId) => senderId === 7 || senderId === 8,
  logger: createCollectingLogger(logs),
});
controller.register(ipcMain);

assert.equal(ELECTRON_API_IPC_CHANNELS.length, 5);
assert.equal(new Set(ELECTRON_API_IPC_CHANNELS).size, 5);
assert.deepEqual(new Set(ipcMain.handlers.keys()), new Set(ELECTRON_API_IPC_CHANNELS));

const contextBridge = new FakeContextBridge();
const renderer7 = new FakeIpcRenderer(ipcMain, 7);
const bridge7 = exposeDesktopApi({
  contextBridge,
  ipcRenderer: renderer7,
});
assert.equal(contextBridge.exposures.get(NOVEL_DESKTOP_BRIDGE_KEY), bridge7);
assert.equal(Object.isFrozen(bridge7), true);
assert.deepEqual(Object.keys(bridge7).sort(), [
  "cancelRequest",
  "closeSubscription",
  "commands",
  "openSubscription",
  "readSubscription",
  "request",
  "workspaces",
]);
assert.equal(Object.isFrozen(bridge7.workspaces), true);
assert.equal(Object.isFrozen(bridge7.commands), true);
const receivedCommands = [];
const unsubscribeCommands = bridge7.commands.subscribe((command) =>
  receivedCommands.push(command),
);
renderer7.emit(ELECTRON_APPLICATION_COMMAND_CHANNEL, "settings.open");
renderer7.emit(ELECTRON_APPLICATION_COMMAND_CHANNEL, "private.command");
assert.deepEqual(receivedCommands, ["settings.open"]);
unsubscribeCommands();
renderer7.emit(ELECTRON_APPLICATION_COMMAND_CHANNEL, "workspace.open");
assert.deepEqual(receivedCommands, ["settings.open"]);

const bridge8 = createElectronPreloadBridge({
  ipcRenderer: new FakeIpcRenderer(ipcMain, 8),
});
const unauthorizedBridge = createElectronPreloadBridge({
  ipcRenderer: new FakeIpcRenderer(ipcMain, 9),
});

await assertClientRoundTrip(bridge7, hostTransport);
await assertSenderOwnership(bridge7, bridge8);
await assertUnauthorizedSender(unauthorizedBridge);
await assertCancellation(bridge7, hostTransport);
await assertFailureRedaction(bridge7, hostTransport, logs);
await assertSenderRelease(controller, bridge8, hostTransport);
await assertControllerDisposal(controller, ipcMain, bridge7);
await assertPreloadSourceBoundary();

console.log("electron main preload smoke passed");

async function assertClientRoundTrip(bridge, host) {
  const conversationId = "conversation-main-preload";
  const requestIds = ["request-open", "request-events"];
  const transport = new ElectronApiTransport({ bridge });
  const api = new DefaultNovelApiClient({
    transport,
    requestIdFactory: () => requestIds.shift(),
  });
  const conversation = await api.conversations.open(conversationId);
  const events = conversation.events.subscribe({ start: { from: "start" } });
  const result = await events.next();

  assert.equal(result.done, false);
  assert.equal(result.value.conversationId, conversationId);
  assert.equal(result.value.sequence, 1);
  assert.equal(events.id, "electron:request-events");
  assert.equal(host.subscriptions[0].id, "host:request-events");
  await events.close();
  await transport.close();
}

async function assertSenderOwnership(ownerBridge, otherBridge) {
  const request = createRequest("owner-subscription", "test.subscribe", {
    conversationId: "conversation-owner",
  });
  const subscriptionId = "electron:owner-subscription";
  assert.equal(
    (await ownerBridge.openSubscription({ subscriptionId, request })).ok,
    true,
  );
  const crossSenderRead = await otherBridge.readSubscription(subscriptionId);
  assert.deepEqual(crossSenderRead, {
    ok: false,
    error: { code: "ELECTRON_SUBSCRIPTION_NOT_FOUND", retryable: false },
  });
  const ownerRead = await ownerBridge.readSubscription(subscriptionId);
  assert.equal(ownerRead.ok, true);
  assert.equal(ownerRead.value.frame.subscriptionId, subscriptionId);
  await ownerBridge.closeSubscription(subscriptionId);
}

async function assertUnauthorizedSender(bridge) {
  const result = await bridge.request(
    createRequest("unauthorized-request", "test.request", null),
  );
  assert.deepEqual(result, {
    ok: false,
    error: { code: "ELECTRON_IPC_UNAUTHORIZED", retryable: false },
  });
}

async function assertCancellation(bridge, host) {
  const transport = new ElectronApiTransport({ bridge });
  const controller = new AbortController();
  const pending = transport.request(
    createRequest("cancelled-request", "test.pending", null),
    { signal: controller.signal },
  );
  await waitFor(() => host.pendingRequestIds.has("cancelled-request"));
  controller.abort(new DOMException("renderer cancelled", "AbortError"));

  await assert.rejects(pending, (error) => error?.name === "AbortError");
  await waitFor(() => host.abortedRequestIds.includes("cancelled-request"));
  await transport.close();
}

async function assertFailureRedaction(bridge, host, entries) {
  const privatePayload = "private-renderer-payload";
  const transport = new ElectronApiTransport({ bridge });
  await assert.rejects(
    transport.request(
      createRequest("failed-request", "test.throw", { privatePayload }),
    ),
    (error) => {
      assert.ok(error instanceof ApiTransportError);
      assert.equal(error.code, "ELECTRON_MAIN_FAILURE");
      assert.equal(error.message.includes(host.privateError), false);
      return true;
    },
  );
  const serializedLogs = JSON.stringify(entries);
  assert.equal(serializedLogs.includes(privatePayload), false);
  assert.equal(serializedLogs.includes(host.privateError), false);
  await transport.close();
}

async function assertSenderRelease(controller, bridge, host) {
  const subscriptionId = "electron:released-subscription";
  await bridge.openSubscription({
    subscriptionId,
    request: createRequest("released-subscription", "test.subscribe", null),
  });
  const pending = bridge.request(
    createRequest("released-request", "test.pending", null),
  );
  await waitFor(() => host.pendingRequestIds.has("released-request"));
  await controller.releaseSender(8);
  const pendingResult = await pending;

  assert.deepEqual(pendingResult, {
    ok: false,
    error: { code: "ELECTRON_REQUEST_CANCELLED", retryable: false },
  });
  assert.equal(host.abortedRequestIds.includes("released-request"), true);
  assert.equal(
    host.closedSubscriptionIds.includes("host:released-subscription"),
    true,
  );
}

async function assertControllerDisposal(controller, ipcMain, bridge) {
  await controller.dispose();
  await controller.dispose();
  assert.equal(ipcMain.handlers.size, 0);
  const transport = new ElectronApiTransport({ bridge });
  await assert.rejects(
    transport.request(createRequest("after-dispose", "test.request", null)),
    ApiTransportDisconnectedError,
  );
  await transport.close();
}

async function assertPreloadSourceBoundary() {
  const createSource = await readFile(
    new URL("../src/preload/createElectronPreloadBridge.ts", import.meta.url),
    "utf8",
  );
  const exposeSource = await readFile(
    new URL("../src/preload/exposeDesktopApi.ts", import.meta.url),
    "utf8",
  );
  assert.equal(/from\s+["']electron["']/.test(createSource + exposeSource), false);
  assert.equal(/from\s+["']node:/.test(createSource + exposeSource), false);
  assert.equal(/\bfs\b|\bchild_process\b|\bprocess\s*\./.test(createSource), false);
  assert.equal(exposeSource.includes("NOVEL_DESKTOP_BRIDGE_KEY"), true);
  const usedChannelKeys = [...createSource.matchAll(
    /ELECTRON_API_IPC_CHANNEL\.(\w+)/g,
  )].map((match) => match[1]);
  assert.deepEqual(
    new Set(usedChannelKeys),
    new Set(Object.keys(ELECTRON_API_IPC_CHANNEL)),
  );
}

function createRequest(requestId, operation, payload) {
  return { protocolVersion: 1, requestId, operation, payload };
}

function successResponse(requestId, data) {
  return { protocolVersion: 1, requestId, ok: true, data };
}

function createConversationSnapshot(conversationId) {
  return {
    metadata: {
      id: conversationId,
      workspaceId: "workspace-1",
      rootConversationId: conversationId,
      status: "active",
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
      lastJournalSequence: 1,
    },
    activeAgentBinding: {
      id: `binding-${conversationId}`,
      conversationId,
      revision: 1,
      agentType: "novel.main",
      definitionVersion: "1",
      status: "active",
      createdAt: "2026-08-03T00:00:00.000Z",
    },
  };
}

function createInputFrame(subscriptionId, conversationId, sequence) {
  const input = new UserMessageInputEvent({
    id: `input-${sequence}`,
    conversationId,
    timestamp: "2026-08-03T00:00:01.000Z",
    text: "private-conversation-text",
  }).getSnapshot();
  return {
    protocolVersion: 1,
    subscriptionId,
    event: {
      ...input,
      direction: "input",
      sequence,
      recordedAt: "2026-08-03T00:00:02.000Z",
    },
  };
}

function createCollectingLogger(entries) {
  return {
    debug: (event, fields) => entries.push({ level: "debug", event, fields }),
    info: (event, fields) => entries.push({ level: "info", event, fields }),
    warn: (event, fields) => entries.push({ level: "warn", event, fields }),
    error: (event, fields) => entries.push({ level: "error", event, fields }),
    child() {
      return this;
    },
  };
}

function jsonRoundTrip(value) {
  return JSON.parse(JSON.stringify(value));
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for IPC state");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
