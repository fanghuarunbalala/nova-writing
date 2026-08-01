import assert from "node:assert/strict";
import {
  CONVERSATION_RUNTIME_ACTIVATION_REASON,
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
  ConversationHostClosedError,
  ConversationHostClosingError,
  ConversationHostSignalConflictError,
  ConversationHostSignalQueueFullError,
  ConversationNotFoundError,
  ConversationRuntimeHandleMismatchError,
  ManagedConversationHost,
} from "../dist/index.js";

class IncrementingClock {
  constructor() {
    this.offset = 0;
  }

  now() {
    const value = new Date(Date.UTC(2026, 7, 1, 0, 0, 0, this.offset));
    this.offset += 1;
    return value.toISOString();
  }
}

class SequentialRuntimeInstanceIdGenerator {
  constructor() {
    this.nextId = 1;
  }

  generate() {
    return `rt_smoke_${this.nextId++}`;
  }
}

class CollectingLogger {
  constructor(entries = [], bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }

  debug(event, fields = {}) {
    this.record("debug", event, fields);
  }

  info(event, fields = {}) {
    this.record("info", event, fields);
  }

  warn(event, fields = {}) {
    this.record("warn", event, fields);
  }

  error(event, fields = {}) {
    this.record("error", event, fields);
  }

  child(bindings) {
    return new CollectingLogger(this.entries, { ...this.bindings, ...bindings });
  }

  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

class FakeSnapshotReader {
  constructor(conversationIds) {
    this.conversationIds = new Set(conversationIds);
  }

  async getSnapshot(conversationId) {
    if (!this.conversationIds.has(conversationId)) {
      throw new ConversationNotFoundError(conversationId);
    }
    return createSnapshot(conversationId);
  }
}

class FakeBootstrapFactory {
  constructor() {
    this.requests = [];
  }

  async create(request) {
    this.requests.push(request);
    return Object.freeze({
      schemaVersion: 1,
      runtimeInstanceId: request.runtimeInstanceId,
      activatedAt: request.activatedAt,
      conversation: createSnapshot(request.conversationId),
      workspace: Object.freeze({
        workspaceId: "workspace-host-lifecycle",
        workdir: "/workspace/host-lifecycle",
      }),
      activation: request.activation,
      journal: Object.freeze({ highWatermark: 100 }),
    });
  }
}

class FakeRuntimeHandle {
  constructor(conversationId, runtimeInstanceId, executionOrder = []) {
    this.conversationId = conversationId;
    this.runtimeInstanceId = runtimeInstanceId;
    this.executionOrder = executionOrder;
    this.inputs = [];
    this.shutdownRequests = [];
    this.dispatchFailuresRemaining = 0;
    this.exit = deferred();
    this.exitSettled = false;
  }

  async dispatchInput(input) {
    this.inputs.push(input);
    this.executionOrder.push(`runtime:${input.sequence}`);
    if (this.dispatchFailuresRemaining > 0) {
      this.dispatchFailuresRemaining -= 1;
      const error = new Error("secret dispatch failure");
      error.code = "FAKE_DISPATCH_FAILED";
      throw error;
    }
  }

  async shutdown(request) {
    this.shutdownRequests.push(request);
    this.stop(request.reason);
  }

  waitForExit() {
    return this.exit.promise;
  }

  stop(reason = CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown) {
    if (this.exitSettled) return;
    this.exitSettled = true;
    this.exit.resolve(
      Object.freeze({
        kind: "stopped",
        exitedAt: "2026-08-01T00:10:00.000Z",
        reason,
      }),
    );
  }

  crash(errorName = "FakeRuntimeCrash", errorCode = "FAKE_RUNTIME_CRASH") {
    if (this.exitSettled) return;
    this.exitSettled = true;
    this.exit.resolve(
      Object.freeze({
        kind: "crashed",
        exitedAt: "2026-08-01T00:10:01.000Z",
        errorName,
        errorCode,
      }),
    );
  }
}

class FakePlacement {
  constructor(options = {}) {
    this.options = options;
    this.bootstraps = [];
    this.handles = [];
  }

  async activate(bootstrap) {
    this.bootstraps.push(bootstrap);
    if (this.options.activationGate) {
      await this.options.activationGate.promise;
    }
    const handle = this.options.createHandle
      ? this.options.createHandle(bootstrap, this.handles.length)
      : new FakeRuntimeHandle(
          bootstrap.conversation.metadata.id,
          bootstrap.runtimeInstanceId,
          this.options.executionOrder,
        );
    this.handles.push(handle);
    return handle;
  }
}

class FakeControlDispatcher {
  constructor(executionOrder = []) {
    this.calls = [];
    this.executionOrder = executionOrder;
    this.failuresRemaining = 0;
    this.nextOutputSequence = 10_000;
  }

  async dispatch(signal, context) {
    this.calls.push({ signal, context });
    this.executionOrder.push(`control:${signal.sequence}`);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("secret control failure");
    }
    const handler = signal.route.handler;
    const outcome = context.runtime
      ? "runtime_notified"
      : handler === "reload_config"
        ? "deferred"
        : "no_runtime";
    return Object.freeze({
      handler,
      outcome,
      outputReceipt: Object.freeze({
        status: "recorded",
        conversationId: signal.conversationId,
        outputEventId: `output-control-${signal.sequence}`,
        sequence: this.nextOutputSequence++,
        recordedAt: signal.recordedAt,
      }),
    });
  }
}

class FakeOutputPublisher {
  constructor() {
    this.events = [];
    this.nextSequence = 1;
    this.failuresRemaining = 0;
    this.failAlways = false;
  }

  async publish(event) {
    const snapshot = event.getSnapshot();
    this.events.push(snapshot);
    if (this.failAlways || this.failuresRemaining > 0) {
      if (this.failuresRemaining > 0) this.failuresRemaining -= 1;
      const error = new Error("secret lifecycle output failure");
      error.code = "LIFECYCLE_OUTPUT_FAILED";
      throw error;
    }
    const sequence = this.nextSequence++;
    return Object.freeze({
      status: "recorded",
      conversationId: snapshot.conversationId,
      outputEventId: snapshot.id,
      sequence,
      recordedAt: snapshot.timestamp,
    });
  }
}

function createHost(conversationIds, options = {}) {
  const logger = options.logger ?? new CollectingLogger();
  const bootstrapFactory = options.bootstrapFactory ?? new FakeBootstrapFactory();
  const placement = options.placement ?? new FakePlacement();
  const controlDispatcher =
    options.controlDispatcher ?? new FakeControlDispatcher();
  const outputPublisher = options.outputPublisher ?? new FakeOutputPublisher();
  const host = new ManagedConversationHost({
    snapshotReader: new FakeSnapshotReader(conversationIds),
    bootstrapFactory,
    placement,
    controlDispatcher,
    outputPublisher,
    clock: new IncrementingClock(),
    runtimeInstanceIdGenerator: new SequentialRuntimeInstanceIdGenerator(),
    logger,
    ...(options.controlQueueCapacity !== undefined
      ? { controlQueueCapacity: options.controlQueueCapacity }
      : {}),
    ...(options.runtimeQueueCapacity !== undefined
      ? { runtimeQueueCapacity: options.runtimeQueueCapacity }
      : {}),
  });
  return {
    host,
    logger,
    bootstrapFactory,
    placement,
    controlDispatcher,
    outputPublisher,
  };
}

function createSignal(options) {
  return Object.freeze({
    conversationId: options.conversationId,
    inputEventId: options.inputEventId ?? `input-${options.sequence}`,
    eventType: options.eventType ?? "user.message",
    priority: options.priority ?? 0,
    sequence: options.sequence,
    recordedAt: "2026-08-01T00:00:00.000Z",
    journalStatus: options.journalStatus ?? "appended",
    route:
      options.route ?? Object.freeze({ target: "runtime", activation: "required" }),
  });
}

function createSnapshot(conversationId) {
  return Object.freeze({
    metadata: Object.freeze({
      id: conversationId,
      workspaceId: "workspace-host-lifecycle",
      title: "Host Lifecycle",
      status: "active",
      revision: 1,
      lastJournalSequence: 0,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    }),
    activeAgentBinding: Object.freeze({
      id: `binding-${conversationId}`,
      conversationId,
      agentType: "novel.main",
      definitionVersion: "1",
      status: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
    }),
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate, label) {
  const deadline = Date.now() + 2_000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

{
  const { host, placement, bootstrapFactory, outputPublisher } = createHost([
    "conversation-basic",
  ]);
  assert.deepEqual(await host.getRuntimePresence("conversation-basic"), {
    state: "offline",
    observedAt: "2026-08-01T00:00:00.000Z",
  });
  await assert.rejects(
    host.getRuntimePresence("conversation-missing"),
    ConversationNotFoundError,
  );

  const signal = createSignal({ conversationId: "conversation-basic", sequence: 1 });
  await host.notifyAccepted(signal);
  await waitUntil(() => placement.handles[0]?.inputs.length === 1, "basic dispatch");
  assert.equal(bootstrapFactory.requests[0].activation.reason, "accepted_input");
  assert.equal(bootstrapFactory.requests[0].activation.input.sequence, 1);
  assert.equal((await host.getRuntimePresence("conversation-basic")).state, "online");
  assert.deepEqual(
    outputPublisher.events.slice(0, 2).map((event) => ({
      eventType: event.eventType,
      previousState: event.payload.previous.state,
      currentState: event.payload.current.state,
      reason: event.payload.reason,
      causationId: event.causationId,
    })),
    [
      {
        eventType: "system.runtime.presence.changed",
        previousState: "offline",
        currentState: "starting",
        reason: "accepted_input",
        causationId: "input-1",
      },
      {
        eventType: "system.runtime.presence.changed",
        previousState: "starting",
        currentState: "online",
        reason: "activation_succeeded",
        causationId: "input-1",
      },
    ],
  );

  await host.notifyAccepted({ ...signal, journalStatus: "duplicate" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(placement.handles[0].inputs.length, 1);

  const [first, second] = await Promise.all([
    host.ensureActive({
      conversationId: "conversation-basic",
      reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore,
    }),
    host.ensureActive({
      conversationId: "conversation-basic",
      reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore,
    }),
  ]);
  assert.equal(first.status, "reused");
  assert.equal(second.status, "reused");
  assert.equal(placement.handles.length, 1);
  await host.close();
  assert.deepEqual(
    outputPublisher.events.slice(-2).map((event) => ({
      previousState: event.payload.previous.state,
      currentState: event.payload.current.state,
      reason: event.payload.reason,
    })),
    [
      {
        previousState: "online",
        currentState: "stopping",
        reason: "host_close",
      },
      {
        previousState: "stopping",
        currentState: "offline",
        reason: "runtime_stopped",
      },
    ],
  );
}

{
  const executionOrder = [];
  const activationGate = deferred();
  const placement = new FakePlacement({ activationGate, executionOrder });
  const controlDispatcher = new FakeControlDispatcher(executionOrder);
  const { host } = createHost(["conversation-control-first"], {
    placement,
    controlDispatcher,
  });
  await host.notifyAccepted(
    createSignal({ conversationId: "conversation-control-first", sequence: 10 }),
  );
  await waitUntil(() => placement.bootstraps.length === 1, "activation start");
  await host.notifyAccepted(
    createSignal({
      conversationId: "conversation-control-first",
      sequence: 11,
      priority: 100,
      eventType: "system.stop",
      route: Object.freeze({
        target: "host",
        handler: "stop",
        runtimeNotification: "if_online",
      }),
    }),
  );
  activationGate.resolve();
  await waitUntil(() => placement.handles[0]?.inputs.length === 1, "ordered dispatch");
  assert.deepEqual(executionOrder, ["control:11", "runtime:10"]);
  assert.equal(controlDispatcher.calls[0].context.runtime.runtimeInstanceId, "rt_smoke_1");
  await host.close();
}

{
  const placement = new FakePlacement({
    createHandle(bootstrap) {
      const handle = new FakeRuntimeHandle(
        bootstrap.conversation.metadata.id,
        bootstrap.runtimeInstanceId,
      );
      handle.dispatchFailuresRemaining = 1;
      return handle;
    },
  });
  const { host, logger } = createHost(["conversation-retry"], { placement });
  const signal = createSignal({ conversationId: "conversation-retry", sequence: 20 });
  await host.notifyAccepted(signal);
  await waitUntil(() => placement.handles[0]?.inputs.length === 1, "failed dispatch");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(placement.handles[0].inputs.length, 1);
  await host.notifyAccepted({ ...signal, journalStatus: "duplicate" });
  await waitUntil(() => placement.handles[0].inputs.length === 2, "duplicate wake-up");
  assert.equal(
    logger.entries.some(
      (entry) => entry.event === "conversation_host.runtime.input_dispatch_failed",
    ),
    true,
  );
  await host.close();
}

{
  const { host, placement, bootstrapFactory, outputPublisher } = createHost([
    "conversation-crash-recovery",
  ]);
  await host.notifyAccepted(
    createSignal({ conversationId: "conversation-crash-recovery", sequence: 30 }),
  );
  await waitUntil(() => placement.handles[0]?.inputs.length === 1, "initial dispatch");
  placement.handles[0].crash();
  await waitUntil(
    async () =>
      (await host.getRuntimePresence("conversation-crash-recovery")).state ===
      "crashed",
    "crashed presence",
  );
  assert.equal(outputPublisher.events.at(-1).payload.reason, "runtime_crashed");
  await host.notifyAccepted(
    createSignal({ conversationId: "conversation-crash-recovery", sequence: 31 }),
  );
  await waitUntil(() => placement.handles[1]?.inputs.length === 1, "recovery dispatch");
  assert.equal(bootstrapFactory.requests[1].activation.reason, "crash_recovery");
  assert.equal(placement.handles[1].inputs[0].sequence, 31);
  assert.deepEqual(
    outputPublisher.events
      .filter((event) => event.payload.reason === "crash_recovery")
      .map((event) => event.causationId),
    ["input-31"],
  );
  await host.close();
}

{
  const logger = new CollectingLogger();
  const outputPublisher = new FakeOutputPublisher();
  outputPublisher.failAlways = true;
  const { host, placement } = createHost(["conversation-output-degradation"], {
    logger,
    outputPublisher,
  });
  await host.notifyAccepted(
    createSignal({
      conversationId: "conversation-output-degradation",
      sequence: 65,
    }),
  );
  await waitUntil(
    () => placement.handles[0]?.inputs.length === 1,
    "dispatch after lifecycle publication failure",
  );
  assert.equal(
    (await host.getRuntimePresence("conversation-output-degradation")).state,
    "online",
  );
  assert.deepEqual(
    outputPublisher.events.slice(0, 2).map((event) => event.payload.reason),
    ["accepted_input", "activation_succeeded"],
  );
  assert.equal(
    logger.entries.filter(
      (entry) =>
        entry.event === "conversation_host.runtime.presence_publish_failed",
    ).length,
    2,
  );
  await host.close();
}

{
  const { host, placement } = createHost(["conversation-if-online"]);
  await host.notifyAccepted(
    createSignal({
      conversationId: "conversation-if-online",
      sequence: 40,
      route: Object.freeze({ target: "runtime", activation: "if_online" }),
    }),
  );
  await waitUntil(
    async () => (await host.getRuntimePresence("conversation-if-online")).state === "offline",
    "offline if-online handling",
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(placement.handles.length, 0);
  await host.close();
}

{
  const mismatchShutdowns = [];
  const placement = new FakePlacement({
    createHandle(bootstrap) {
      const handle = new FakeRuntimeHandle(
        "wrong-conversation",
        `wrong-${bootstrap.runtimeInstanceId}`,
      );
      const originalShutdown = handle.shutdown.bind(handle);
      handle.shutdown = async (request) => {
        mismatchShutdowns.push(request);
        await originalShutdown(request);
      };
      return handle;
    },
  });
  const { host } = createHost(["conversation-mismatch"], { placement });
  await assert.rejects(
    host.ensureActive({
      conversationId: "conversation-mismatch",
      reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore,
    }),
    ConversationRuntimeHandleMismatchError,
  );
  await waitUntil(() => mismatchShutdowns.length === 1, "mismatch shutdown");
  assert.equal(mismatchShutdowns[0].reason, "replacement");
  assert.equal((await host.getRuntimePresence("conversation-mismatch")).state, "crashed");
  await host.close();
}

{
  const activationGate = deferred();
  const placement = new FakePlacement({ activationGate });
  const { host } = createHost(["conversation-capacity"], {
    placement,
    runtimeQueueCapacity: 1,
  });
  await host.notifyAccepted(
    createSignal({ conversationId: "conversation-capacity", sequence: 50 }),
  );
  await waitUntil(() => placement.bootstraps.length === 1, "capacity activation");
  await assert.rejects(
    host.notifyAccepted(
      createSignal({ conversationId: "conversation-capacity", sequence: 51 }),
    ),
    ConversationHostSignalQueueFullError,
  );
  await assert.rejects(
    host.notifyAccepted(
      createSignal({
        conversationId: "conversation-capacity",
        sequence: 50,
        inputEventId: "conflicting-input",
      }),
    ),
    ConversationHostSignalConflictError,
  );
  activationGate.resolve();
  await waitUntil(() => placement.handles[0]?.inputs.length === 1, "capacity drain");
  await host.close();
}

{
  const { host, placement } = createHost(["conversation-shutdown"]);
  await host.ensureActive({
    conversationId: "conversation-shutdown",
    reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore,
  });
  const shutdown = await host.shutdownRuntime({
    conversationId: "conversation-shutdown",
    reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown,
  });
  assert.equal(shutdown.status, "stopped");
  assert.equal(shutdown.presence.state, "offline");
  assert.equal(placement.handles[0].shutdownRequests.length, 1);
  assert.equal(
    (
      await host.shutdownRuntime({
        conversationId: "conversation-shutdown",
        reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown,
      })
    ).status,
    "already_offline",
  );
  const closePromise = host.close();
  assert.equal(host.close(), closePromise);
  await closePromise;
  await assert.rejects(
    host.getRuntimePresence("conversation-shutdown"),
    ConversationHostClosedError,
  );
}

{
  const activationGate = deferred();
  const placement = new FakePlacement({ activationGate });
  const { host } = createHost(["conversation-closing"], { placement });
  const activation = host.ensureActive({
    conversationId: "conversation-closing",
    reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore,
  });
  await waitUntil(() => placement.bootstraps.length === 1, "closing activation");
  const closePromise = host.close();
  await assert.rejects(
    host.notifyAccepted(
      createSignal({ conversationId: "conversation-closing", sequence: 60 }),
    ),
    ConversationHostClosingError,
  );
  activationGate.resolve();
  await activation;
  await closePromise;
}

{
  const logger = new CollectingLogger();
  const { host } = createHost(["conversation-log-safety"], { logger });
  await host.notifyAccepted(
    createSignal({ conversationId: "conversation-log-safety", sequence: 70 }),
  );
  await waitUntil(
    () =>
      logger.entries.some(
        (entry) => entry.event === "conversation_host.runtime.input_dispatched",
      ),
    "safe logs",
  );
  const serializedLogs = JSON.stringify(logger.entries);
  for (const forbidden of [
    "secret dispatch failure",
    "secret control failure",
    "secret lifecycle output failure",
    "systemPrompt",
    "apiKey",
    "payload",
    "stack",
    "cause",
    "/workspace/host-lifecycle",
  ]) {
    assert.equal(serializedLogs.includes(forbidden), false);
  }
  await host.close();
}

console.log("conversation host lifecycle smoke passed");
