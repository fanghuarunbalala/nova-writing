import assert from "node:assert/strict";
import {
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
  CONVERSATION_RUNTIME_STATE,
  ConversationRuntime,
  ConversationRuntimeDispatchFailureError,
  ConversationRuntimeInputPumpError,
  ConversationRuntimeStartError,
  ConversationRuntimeStateError,
  InputRouter,
  RUNTIME_INPUT_RESOLUTION_FAILURE,
  RuntimeInputPump,
  RuntimeInputResolutionError,
} from "../dist/index.js";

const conversationId = "conversation-runtime-shell";
const runtimeInstanceId = "runtime-shell-1";
const timestamp = "2026-08-01T16:00:00.000Z";
const forbidden = [
  "FORBIDDEN_RUNTIME_PAYLOAD",
  "FORBIDDEN_RUNTIME_PROMPT",
  "FORBIDDEN_RUNTIME_PATH",
  "FORBIDDEN_RUNTIME_STACK",
];

class CollectingLogger {
  constructor(records = [], bindings = {}) {
    this.records = records;
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
    return new CollectingLogger(this.records, { ...this.bindings, ...bindings });
  }

  record(level, event, fields) {
    this.records.push({ level, event, ...this.bindings, ...fields });
  }
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

class FakeInputPump {
  constructor(options = {}) {
    this.options = options;
    this.exitGate = deferred();
    this.startCount = 0;
    this.wakeCount = 0;
    this.stopCount = 0;
    this.settled = false;
  }

  start() {
    this.startCount += 1;
    if (this.options.startError !== undefined) throw this.options.startError;
  }

  wake() {
    this.wakeCount += 1;
    if (this.options.wakeError !== undefined) throw this.options.wakeError;
  }

  async stop() {
    this.stopCount += 1;
    if (this.options.stopGate !== undefined) await this.options.stopGate.promise;
    if (this.options.stopError !== undefined) throw this.options.stopError;
    this.settle(
      this.options.stopExit ??
        Object.freeze({ kind: "stopped", exitedAt: timestamp }),
    );
  }

  waitForExit() {
    if (this.options.observerError !== undefined) {
      return Promise.reject(this.options.observerError);
    }
    return this.exitGate.promise;
  }

  fail(scope) {
    this.settle(
      Object.freeze({
        kind: "failed",
        exitedAt: timestamp,
        scope,
        errorName: "RuntimeInputPumpFailureError",
        errorCode: "RUNTIME_INPUT_PUMP_FAILED",
      }),
    );
  }

  stopUnexpectedly() {
    this.settle(Object.freeze({ kind: "stopped", exitedAt: timestamp }));
  }

  settle(exit) {
    if (this.settled) return;
    this.settled = true;
    this.exitGate.resolve(exit);
  }
}

function startupResult() {
  return Object.freeze({
    conversationId,
    runtimeInstanceId,
    activationReason: "explicit_restore",
    throughSequence: 0,
    scannedEventCount: 0,
    processedInputCount: 0,
    outcomeRepairCount: 0,
    routedInputCount: 0,
  });
}

function reference(sequence) {
  return Object.freeze({
    conversationId,
    inputEventId: `input-${sequence}`,
    eventType: "user.message",
    sequence,
  });
}

function persistedInput(sequence) {
  return Object.freeze({
    id: `input-${sequence}`,
    conversationId,
    eventType: "user.message",
    schemaVersion: 1,
    priority: 500,
    timestamp,
    payload: Object.freeze({ text: "FORBIDDEN_RUNTIME_PAYLOAD" }),
    direction: "input",
    sequence,
    recordedAt: timestamp,
  });
}

function createRuntime(options = {}) {
  const records = options.records ?? [];
  const routed = options.routed ?? [];
  const startupCoordinator =
    options.startupCoordinator ??
    Object.freeze({ start: async () => startupResult() });
  const inputResolver =
    options.inputResolver ??
    Object.freeze({ resolve: async (inputReference) => persistedInput(inputReference.sequence) });
  const inputRouter =
    options.inputRouter ??
    Object.freeze({
      route: (input) => {
        routed.push(input.sequence);
        return Object.freeze({
          status: "enqueued",
          lane: "turn",
          sequence: input.sequence,
        });
      },
    });
  const inputPump = options.inputPump ?? new FakeInputPump();
  return {
    records,
    routed,
    inputPump,
    runtime: new ConversationRuntime({
      conversationId,
      runtimeInstanceId,
      startupCoordinator,
      inputResolver,
      inputRouter,
      inputPump,
      clock: Object.freeze({ now: () => timestamp }),
      logger: new CollectingLogger(records),
    }),
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for smoke-test condition");
}

const created = createRuntime();
assert.equal(created.runtime.state, CONVERSATION_RUNTIME_STATE.created);
await assert.rejects(
  () => created.runtime.dispatchInput(reference(1)),
  (error) =>
    error instanceof ConversationRuntimeStateError &&
    error.state === CONVERSATION_RUNTIME_STATE.created,
);

const startupGate = deferred();
const concurrentStart = createRuntime({
  startupCoordinator: Object.freeze({
    start: async () => {
      await startupGate.promise;
      return startupResult();
    },
  }),
});
const firstStart = concurrentStart.runtime.start(Object.freeze({}));
await waitFor(() => concurrentStart.runtime.state === CONVERSATION_RUNTIME_STATE.starting);
await assert.rejects(
  () => concurrentStart.runtime.start(Object.freeze({})),
  (error) =>
    error instanceof ConversationRuntimeStateError &&
    error.state === CONVERSATION_RUNTIME_STATE.starting,
);
startupGate.resolve();
assert.deepEqual(await firstStart, startupResult());
assert.equal(concurrentStart.runtime.state, CONVERSATION_RUNTIME_STATE.online);
assert.equal(concurrentStart.inputPump.startCount, 1);

const shutdownDuringStartGate = deferred();
const shutdownDuringStart = createRuntime({
  startupCoordinator: Object.freeze({
    start: async () => {
      await shutdownDuringStartGate.promise;
      return startupResult();
    },
  }),
});
const interruptedStart = shutdownDuringStart.runtime.start(Object.freeze({}));
await waitFor(() => shutdownDuringStart.runtime.state === CONVERSATION_RUNTIME_STATE.starting);
const interruptedShutdown = shutdownDuringStart.runtime.shutdown({
  reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.replacement,
});
await assert.rejects(
  () => shutdownDuringStart.runtime.dispatchInput(reference(1)),
  (error) =>
    error instanceof ConversationRuntimeStateError &&
    error.state === CONVERSATION_RUNTIME_STATE.starting,
);
shutdownDuringStartGate.resolve();
await Promise.all([interruptedStart, interruptedShutdown]);
assert.equal(shutdownDuringStart.runtime.state, CONVERSATION_RUNTIME_STATE.stopped);
assert.equal(shutdownDuringStart.inputPump.startCount, 0);
assert.equal(shutdownDuringStart.inputPump.stopCount, 1);
assert.deepEqual(await shutdownDuringStart.runtime.waitForExit(), {
  kind: "stopped",
  exitedAt: timestamp,
  reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.replacement,
});
assert.equal(
  shutdownDuringStart.records.some(
    (record) =>
      record.event === "runtime.lifecycle.state_changed" &&
      record.state === CONVERSATION_RUNTIME_STATE.online,
  ),
  false,
);

const firstDispatchGate = deferred();
const resolveOrder = [];
const serialized = createRuntime({
  inputResolver: Object.freeze({
    resolve: async (inputReference) => {
      resolveOrder.push(`start-${inputReference.sequence}`);
      if (inputReference.sequence === 1) await firstDispatchGate.promise;
      resolveOrder.push(`end-${inputReference.sequence}`);
      return persistedInput(inputReference.sequence);
    },
  }),
});
await serialized.runtime.start(Object.freeze({}));
const firstDispatch = serialized.runtime.dispatchInput(reference(1));
const secondDispatch = serialized.runtime.dispatchInput(reference(2));
await waitFor(() => resolveOrder.includes("start-1"));
assert.deepEqual(resolveOrder, ["start-1"]);
const firstShutdown = serialized.runtime.shutdown({
  reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.hostClose,
});
const duplicateShutdown = serialized.runtime.shutdown({
  reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.replacement,
});
assert.equal(firstShutdown, duplicateShutdown);
await assert.rejects(
  () => serialized.runtime.dispatchInput(reference(3)),
  (error) =>
    error instanceof ConversationRuntimeStateError &&
    error.state === CONVERSATION_RUNTIME_STATE.online,
);
firstDispatchGate.resolve();
await Promise.all([firstDispatch, secondDispatch, firstShutdown]);
assert.deepEqual(resolveOrder, ["start-1", "end-1", "start-2", "end-2"]);
assert.deepEqual(serialized.routed, [1, 2]);
assert.equal(serialized.inputPump.wakeCount, 2);
assert.equal(serialized.inputPump.stopCount, 1);
assert.equal(serialized.runtime.state, CONVERSATION_RUNTIME_STATE.stopped);
const stoppedExit = await serialized.runtime.waitForExit();
assert.deepEqual(stoppedExit, {
  kind: "stopped",
  exitedAt: timestamp,
  reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.hostClose,
});
assert.equal(Object.isFrozen(stoppedExit), true);
await serialized.runtime.shutdown({
  reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown,
});
assert.equal(await serialized.runtime.waitForExit(), stoppedExit);

const offlineShutdown = createRuntime();
await offlineShutdown.runtime.shutdown({
  reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.idleEviction,
});
assert.equal(offlineShutdown.runtime.state, CONVERSATION_RUNTIME_STATE.stopped);
assert.equal(offlineShutdown.inputPump.startCount, 0);
assert.equal(offlineShutdown.inputPump.stopCount, 1);
assert.equal(
  (await offlineShutdown.runtime.waitForExit()).reason,
  CONVERSATION_RUNTIME_SHUTDOWN_REASON.idleEviction,
);
await assert.rejects(
  () => offlineShutdown.runtime.start(Object.freeze({})),
  ConversationRuntimeStateError,
);

const recoverable = createRuntime({
  inputResolver: Object.freeze({
    resolve: async (inputReference) => {
      throw new RuntimeInputResolutionError(
        inputReference.conversationId,
        inputReference.sequence,
        RUNTIME_INPUT_RESOLUTION_FAILURE.notFound,
      );
    },
  }),
});
await recoverable.runtime.start(Object.freeze({}));
await assert.rejects(
  () => recoverable.runtime.dispatchInput(reference(4)),
  RuntimeInputResolutionError,
);
assert.equal(recoverable.runtime.state, CONVERSATION_RUNTIME_STATE.online);
assert.equal(recoverable.inputPump.wakeCount, 0);
await assert.rejects(
  () => recoverable.runtime.shutdown({ reason: "FORBIDDEN_RUNTIME_PATH" }),
  TypeError,
);
assert.equal(recoverable.runtime.state, CONVERSATION_RUNTIME_STATE.online);
await recoverable.runtime.shutdown({
  reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown,
});

const startupFailure = createRuntime({
  startupCoordinator: Object.freeze({
    start: async () => {
      throw new Error("FORBIDDEN_RUNTIME_PROMPT");
    },
  }),
});
await assert.rejects(
  () => startupFailure.runtime.start(Object.freeze({})),
  (error) =>
    error instanceof ConversationRuntimeStartError &&
    error.failureName === "UnknownError" &&
    !error.message.includes("FORBIDDEN"),
);
assert.equal(startupFailure.runtime.state, CONVERSATION_RUNTIME_STATE.crashed);
assert.deepEqual(await startupFailure.runtime.waitForExit(), {
  kind: "crashed",
  exitedAt: timestamp,
  errorName: "ConversationRuntimeStartError",
  errorCode: "CONVERSATION_RUNTIME_START_FAILED",
});
await waitFor(() => startupFailure.inputPump.stopCount === 1);

const dispatchFailure = createRuntime({
  inputResolver: Object.freeze({
    resolve: async () => {
      const error = new Error("FORBIDDEN_RUNTIME_STACK");
      error.name = "Unsafe Error Name: FORBIDDEN_RUNTIME_STACK";
      throw error;
    },
  }),
});
await dispatchFailure.runtime.start(Object.freeze({}));
const failedDispatch = dispatchFailure.runtime.dispatchInput(reference(5));
const queuedAfterFailure = dispatchFailure.runtime.dispatchInput(reference(6));
await assert.rejects(
  () => failedDispatch,
  (error) =>
    error instanceof ConversationRuntimeDispatchFailureError &&
    error.failureName === "UnknownError" &&
    !error.message.includes("FORBIDDEN"),
);
await assert.rejects(
  () => queuedAfterFailure,
  (error) =>
    error instanceof ConversationRuntimeStateError &&
    error.state === CONVERSATION_RUNTIME_STATE.crashed,
);
assert.equal(dispatchFailure.runtime.state, CONVERSATION_RUNTIME_STATE.crashed);
assert.deepEqual(await dispatchFailure.runtime.waitForExit(), {
  kind: "crashed",
  exitedAt: timestamp,
  errorName: "ConversationRuntimeDispatchFailureError",
  errorCode: "CONVERSATION_RUNTIME_INPUT_DISPATCH_FAILED",
});
await waitFor(() => dispatchFailure.inputPump.stopCount === 1);
await assert.rejects(
  () => dispatchFailure.runtime.dispatchInput(reference(7)),
  ConversationRuntimeStateError,
);
await dispatchFailure.runtime.shutdown({
  reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.replacement,
});

const asynchronousPumpFailure = createRuntime();
await asynchronousPumpFailure.runtime.start(Object.freeze({}));
asynchronousPumpFailure.inputPump.fail("turn");
assert.deepEqual(await asynchronousPumpFailure.runtime.waitForExit(), {
  kind: "crashed",
  exitedAt: timestamp,
  errorName: "ConversationRuntimeInputPumpError",
  errorCode: "CONVERSATION_RUNTIME_INPUT_PUMP_FAILED",
});
assert.equal(asynchronousPumpFailure.runtime.state, CONVERSATION_RUNTIME_STATE.crashed);

const unexpectedPumpStop = createRuntime();
await unexpectedPumpStop.runtime.start(Object.freeze({}));
unexpectedPumpStop.inputPump.stopUnexpectedly();
assert.deepEqual(await unexpectedPumpStop.runtime.waitForExit(), {
  kind: "crashed",
  exitedAt: timestamp,
  errorName: "ConversationRuntimeInputPumpError",
  errorCode: "CONVERSATION_RUNTIME_INPUT_PUMP_FAILED",
});

const failedShutdownPump = new FakeInputPump({
  stopExit: Object.freeze({
    kind: "failed",
    exitedAt: timestamp,
    scope: "control",
    errorName: "RuntimeInputPumpFailureError",
    errorCode: "RUNTIME_INPUT_PUMP_FAILED",
  }),
});
const failedPumpShutdown = createRuntime({ inputPump: failedShutdownPump });
await failedPumpShutdown.runtime.start(Object.freeze({}));
await assert.rejects(
  () =>
    failedPumpShutdown.runtime.shutdown({
      reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.hostClose,
    }),
  (error) =>
    error instanceof ConversationRuntimeInputPumpError &&
    error.scope === "control",
);
assert.equal(failedPumpShutdown.runtime.state, CONVERSATION_RUNTIME_STATE.crashed);

const rejectedPumpStop = createRuntime({
  inputPump: new FakeInputPump({
    stopError: new Error("FORBIDDEN_RUNTIME_STACK"),
  }),
});
await rejectedPumpStop.runtime.start(Object.freeze({}));
await assert.rejects(
  () =>
    rejectedPumpStop.runtime.shutdown({
      reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.replacement,
    }),
  (error) =>
    error instanceof ConversationRuntimeInputPumpError &&
    error.scope === "shutdown",
);
assert.equal(rejectedPumpStop.runtime.state, CONVERSATION_RUNTIME_STATE.crashed);

const rejectedPumpObserver = createRuntime({
  inputPump: new FakeInputPump({
    observerError: new Error("FORBIDDEN_RUNTIME_PROMPT"),
  }),
});
assert.deepEqual(await rejectedPumpObserver.runtime.waitForExit(), {
  kind: "crashed",
  exitedAt: timestamp,
  errorName: "ConversationRuntimeInputPumpError",
  errorCode: "CONVERSATION_RUNTIME_INPUT_PUMP_FAILED",
});
assert.equal(rejectedPumpObserver.runtime.state, CONVERSATION_RUNTIME_STATE.crashed);

const actualPumpLogs = [];
const actualRouter = new InputRouter({
  conversationId,
  logger: new CollectingLogger(actualPumpLogs),
});
const handledByActualPump = [];
const actualPump = new RuntimeInputPump({
  conversationId,
  source: actualRouter,
  controlHandler: Object.freeze({
    handle: async (input) => {
      handledByActualPump.push(`control-${input.sequence}`);
    },
  }),
  turnHandler: Object.freeze({
    handle: async (input) => {
      handledByActualPump.push(`turn-${input.sequence}`);
    },
  }),
  clock: Object.freeze({ now: () => timestamp }),
  logger: new CollectingLogger(actualPumpLogs),
});
const actualPumpRuntime = createRuntime({
  records: actualPumpLogs,
  inputRouter: actualRouter,
  inputPump: actualPump,
});
await actualPumpRuntime.runtime.start(Object.freeze({}));
await actualPumpRuntime.runtime.dispatchInput(reference(20));
await waitFor(() => handledByActualPump.includes("turn-20"));
await actualPumpRuntime.runtime.shutdown({
  reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.explicitShutdown,
});
assert.deepEqual(handledByActualPump, ["turn-20"]);

const allLogs = [
  ...created.records,
  ...concurrentStart.records,
  ...shutdownDuringStart.records,
  ...serialized.records,
  ...offlineShutdown.records,
  ...recoverable.records,
  ...startupFailure.records,
  ...dispatchFailure.records,
  ...asynchronousPumpFailure.records,
  ...unexpectedPumpStop.records,
  ...failedPumpShutdown.records,
  ...rejectedPumpStop.records,
  ...rejectedPumpObserver.records,
  ...actualPumpLogs,
];
const serializedLogs = JSON.stringify(allLogs);
for (const token of forbidden) assert.equal(serializedLogs.includes(token), false);
assert.equal(allLogs.some((record) => record.event === "runtime.lifecycle.start_started"), true);
assert.equal(allLogs.some((record) => record.event === "runtime.input.dispatch_completed"), true);
assert.equal(allLogs.some((record) => record.event === "runtime.lifecycle.shutdown_completed"), true);
assert.equal(allLogs.some((record) => record.event === "runtime.lifecycle.start_failed"), true);
assert.equal(allLogs.some((record) => record.event === "runtime.input.dispatch_failed"), true);
assert.equal(allLogs.some((record) => record.event === "runtime.input_pump.failed"), true);

console.log("ConversationRuntime smoke passed");
