import assert from "node:assert/strict";
import {
  INPUT_EVENT_TYPE,
  InputRouter,
  RUNTIME_INPUT_PUMP_STATE,
  RuntimeInputPump,
  RuntimeInputPumpStateError,
} from "../dist/index.js";

const conversationId = "conversation-input-pump";
const timestamp = "2026-08-01T18:00:00.000Z";
const forbidden = [
  "FORBIDDEN_PUMP_PAYLOAD",
  "FORBIDDEN_PUMP_PROMPT",
  "FORBIDDEN_PUMP_PATH",
  "FORBIDDEN_PUMP_STACK",
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

function persistedInput(sequence, eventType, priority) {
  return Object.freeze({
    id: `input-pump-${sequence}`,
    conversationId,
    eventType,
    schemaVersion: 1,
    priority,
    timestamp,
    payload: Object.freeze({ text: "FORBIDDEN_PUMP_PAYLOAD" }),
    direction: "input",
    sequence,
    recordedAt: timestamp,
  });
}

function userInput(sequence) {
  return persistedInput(sequence, INPUT_EVENT_TYPE.userMessage, 500);
}

function stopInput(sequence) {
  return persistedInput(sequence, INPUT_EVENT_TYPE.systemStop, 1000);
}

function reloadInput(sequence) {
  return persistedInput(sequence, INPUT_EVENT_TYPE.reloadConfig, 900);
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for Pump smoke-test condition");
}

const lifecycleLogs = [];
const lifecycleRouter = new InputRouter({
  conversationId,
  logger: new CollectingLogger(lifecycleLogs),
});
const lifecyclePump = new RuntimeInputPump({
  conversationId,
  source: lifecycleRouter,
  controlHandler: Object.freeze({ handle: async () => undefined }),
  turnHandler: Object.freeze({ handle: async () => undefined }),
  clock: Object.freeze({ now: () => timestamp }),
  logger: new CollectingLogger(lifecycleLogs),
});
assert.equal(lifecyclePump.state, RUNTIME_INPUT_PUMP_STATE.created);
assert.equal(Object.isFrozen(lifecyclePump.getSnapshot()), true);
assert.throws(
  () => lifecyclePump.wake(),
  (error) =>
    error instanceof RuntimeInputPumpStateError &&
    error.state === RUNTIME_INPUT_PUMP_STATE.created,
);
lifecyclePump.start();
assert.throws(() => lifecyclePump.start(), RuntimeInputPumpStateError);
const lifecycleStop = lifecyclePump.stop();
const duplicateLifecycleStop = lifecyclePump.stop();
assert.equal(lifecycleStop, duplicateLifecycleStop);
await lifecycleStop;
assert.equal(lifecyclePump.state, RUNTIME_INPUT_PUMP_STATE.stopped);
assert.deepEqual(await lifecyclePump.waitForExit(), {
  kind: "stopped",
  exitedAt: timestamp,
});
assert.throws(() => lifecyclePump.wake(), RuntimeInputPumpStateError);

const orderLogs = [];
const orderRouter = new InputRouter({
  conversationId,
  logger: new CollectingLogger(orderLogs),
});
const turnOneGate = deferred();
const turnThreeGate = deferred();
const turnSixGate = deferred();
const controlFourGate = deferred();
const gates = new Map([
  [1, turnOneGate],
  [3, turnThreeGate],
  [4, controlFourGate],
  [6, turnSixGate],
]);
const order = [];
let controlActive = 0;
let turnActive = 0;
let maximumControlActive = 0;
let maximumTurnActive = 0;
let overlapObserved = false;

const orderPump = new RuntimeInputPump({
  conversationId,
  source: orderRouter,
  controlHandler: Object.freeze({
    handle: async (input) => {
      controlActive += 1;
      maximumControlActive = Math.max(maximumControlActive, controlActive);
      overlapObserved ||= turnActive > 0;
      order.push(`control-start-${input.sequence}`);
      try {
        const gate = gates.get(input.sequence);
        if (gate !== undefined) await gate.promise;
      } finally {
        order.push(`control-end-${input.sequence}`);
        controlActive -= 1;
      }
    },
  }),
  turnHandler: Object.freeze({
    handle: async (input) => {
      turnActive += 1;
      maximumTurnActive = Math.max(maximumTurnActive, turnActive);
      overlapObserved ||= controlActive > 0;
      order.push(`turn-start-${input.sequence}`);
      try {
        const gate = gates.get(input.sequence);
        if (gate !== undefined) await gate.promise;
      } finally {
        order.push(`turn-end-${input.sequence}`);
        turnActive -= 1;
      }
    },
  }),
  clock: Object.freeze({ now: () => timestamp }),
  logger: new CollectingLogger(orderLogs),
});

orderRouter.route(userInput(1));
orderRouter.route(stopInput(2));
orderRouter.route(userInput(3));
orderPump.start();
await waitFor(() => order.includes("turn-start-1"));
assert.deepEqual(order, ["control-start-2", "control-end-2", "turn-start-1"]);

orderRouter.route(reloadInput(4));
orderPump.wake();
await waitFor(() => order.includes("control-start-4"));
assert.equal(overlapObserved, true);
assert.equal(orderPump.getSnapshot().turnInFlight.sequence, 1);
assert.equal(orderPump.getSnapshot().controlInFlight.sequence, 4);

orderRouter.route(stopInput(5));
orderRouter.route(userInput(6));
orderPump.wake();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(order.includes("control-start-5"), false);
assert.equal(order.includes("turn-start-3"), false);

controlFourGate.resolve();
await waitFor(() => order.includes("control-end-5"));
assert.equal(order.indexOf("control-start-5") > order.indexOf("control-end-4"), true);
assert.equal(order.includes("turn-start-3"), false);

turnOneGate.resolve();
await waitFor(() => order.includes("turn-start-3"));
assert.equal(order.includes("turn-start-6"), false);
turnThreeGate.resolve();
await waitFor(() => order.includes("turn-start-6"));
assert.equal(maximumControlActive, 1);
assert.equal(maximumTurnActive, 1);

orderRouter.route(userInput(7));
const orderStop = orderPump.stop();
const duplicateOrderStop = orderPump.stop();
assert.equal(orderStop, duplicateOrderStop);
assert.throws(() => orderPump.wake(), RuntimeInputPumpStateError);
assert.equal(orderRouter.turnInbox.size, 1);
turnSixGate.resolve();
await orderStop;
assert.equal(orderPump.state, RUNTIME_INPUT_PUMP_STATE.stopped);
assert.equal(orderRouter.turnInbox.peek().sequence, 7);
const orderExit = await orderPump.waitForExit();
assert.equal(Object.isFrozen(orderExit), true);
assert.deepEqual(orderExit, { kind: "stopped", exitedAt: timestamp });

const failureLogs = [];
const failureRouter = new InputRouter({
  conversationId,
  logger: new CollectingLogger(failureLogs),
});
failureRouter.route(userInput(10));
failureRouter.route(userInput(11));
const failurePump = new RuntimeInputPump({
  conversationId,
  source: failureRouter,
  controlHandler: Object.freeze({ handle: async () => undefined }),
  turnHandler: Object.freeze({
    handle: async () => {
      const error = new Error("FORBIDDEN_PUMP_PROMPT");
      error.name = "FORBIDDEN_PUMP_STACK";
      error.code = "FORBIDDEN_PUMP_PATH";
      throw error;
    },
  }),
  clock: Object.freeze({ now: () => timestamp }),
  logger: new CollectingLogger(failureLogs),
});
failurePump.start();
const failureExit = await failurePump.waitForExit();
assert.equal(failurePump.state, RUNTIME_INPUT_PUMP_STATE.failed);
assert.deepEqual(failureExit, {
  kind: "failed",
  exitedAt: timestamp,
  scope: "turn",
  errorName: "RuntimeInputPumpFailureError",
  errorCode: "RUNTIME_INPUT_PUMP_FAILED",
  inputEventId: "input-pump-10",
  eventType: INPUT_EVENT_TYPE.userMessage,
  sequence: 10,
});
assert.equal(Object.isFrozen(failureExit), true);
assert.equal(failureRouter.turnInbox.peek().sequence, 11);
assert.throws(() => failurePump.wake(), RuntimeInputPumpStateError);
await failurePump.stop();

// stopping 期间 in-flight handler 失败（如 host_close 截断生成导致 append 失败）
// → 优雅中止（stopped），而非 failed → runtime 不转 crashed（Fix A）。
const abortLogs = [];
const abortRouter = new InputRouter({
  conversationId,
  logger: new CollectingLogger(abortLogs),
});
abortRouter.route(userInput(20));
const abortGate = deferred();
let abortFailed = false;
const abortPump = new RuntimeInputPump({
  conversationId,
  source: abortRouter,
  controlHandler: Object.freeze({ handle: async () => undefined }),
  turnHandler: Object.freeze({
    handle: async () => {
      await abortGate.promise;
      abortFailed = true;
      throw new Error("FORBIDDEN_PUMP_PROMPT");
    },
  }),
  clock: Object.freeze({ now: () => timestamp }),
  logger: new CollectingLogger(abortLogs),
});
abortPump.start();
await waitFor(() => abortPump.getSnapshot().turnInFlight !== undefined);
const abortStop = abortPump.stop();
abortGate.resolve();
await abortStop;
const abortExit = await abortPump.waitForExit();
assert.equal(abortFailed, true);
assert.equal(abortPump.state, RUNTIME_INPUT_PUMP_STATE.stopped);
assert.deepEqual(abortExit, { kind: "stopped", exitedAt: timestamp });

const schedulerLogs = [];
const schedulerPump = new RuntimeInputPump({
  conversationId,
  source: Object.freeze({
    controlInbox: Object.freeze({
      size: 1,
      dequeue: () => {
        throw new Error("FORBIDDEN_PUMP_PATH");
      },
    }),
    turnInbox: Object.freeze({ size: 0, dequeue: () => undefined }),
  }),
  controlHandler: Object.freeze({ handle: async () => undefined }),
  turnHandler: Object.freeze({ handle: async () => undefined }),
  clock: Object.freeze({ now: () => timestamp }),
  logger: new CollectingLogger(schedulerLogs),
});
schedulerPump.start();
assert.deepEqual(await schedulerPump.waitForExit(), {
  kind: "failed",
  exitedAt: timestamp,
  scope: "scheduler",
  errorName: "RuntimeInputPumpFailureError",
  errorCode: "RUNTIME_INPUT_PUMP_FAILED",
});

const allLogs = [...lifecycleLogs, ...orderLogs, ...failureLogs, ...schedulerLogs, ...abortLogs];
const serializedLogs = JSON.stringify(allLogs);
for (const token of forbidden) assert.equal(serializedLogs.includes(token), false);
assert.equal(allLogs.some((record) => record.event === "runtime.input_pump.control_started"), true);
assert.equal(allLogs.some((record) => record.event === "runtime.input_pump.turn_started"), true);
assert.equal(allLogs.some((record) => record.event === "runtime.input_pump.stop_completed"), true);
assert.equal(allLogs.some((record) => record.event === "runtime.input_pump.failed"), true);
assert.equal(allLogs.some((record) => record.event === "runtime.input_pump.stop_aborted_inflight"), true);

console.log("Runtime Input Pump smoke passed");
