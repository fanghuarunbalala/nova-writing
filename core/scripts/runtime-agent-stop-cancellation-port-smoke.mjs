import assert from "node:assert/strict";
import {
  AGENT_RUNTIME_STOP_CANCELLATION_FAILURE,
  AgentRuntimeStopCancellationPort,
  AgentRuntimeStopCancellationPortError,
  EXECUTION_CANCELLATION_REASON,
  INPUT_EVENT_TYPE,
} from "../dist/index.js";

const conversationId = "conversation-agent-stop-cancellation";
const forbidden = [
  "FORBIDDEN_STOP_PAYLOAD",
  "FORBIDDEN_NOVEL_TEXT",
  "FORBIDDEN_ADAPTER_ERROR",
  "FORBIDDEN_WORK_PATH",
];

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
    return new CollectingLogger(this.entries, {
      ...this.bindings,
      ...bindings,
    });
  }

  record(level, event, fields) {
    this.entries.push({
      level,
      event,
      fields: { ...this.bindings, ...fields },
    });
  }
}

function stopInput(sequence) {
  return {
    id: `stop-input-${sequence}`,
    eventType: INPUT_EVENT_TYPE.systemStop,
    sequence,
  };
}

function request(sequence, overrides = {}) {
  return {
    conversationId,
    reason: EXECUTION_CANCELLATION_REASON.stop,
    stopInput: stopInput(sequence),
    runId: `run-${sequence}`,
    turnId: `turn-${sequence}`,
    forbiddenPayload: "FORBIDDEN_STOP_PAYLOAD FORBIDDEN_NOVEL_TEXT",
    ...overrides,
  };
}

function adapter(cancel) {
  return {
    stream: async () => {
      throw new Error("stream is outside this smoke scope");
    },
    cancel,
  };
}

const logs = [];
const capturedRequests = [];
const port = new AgentRuntimeStopCancellationPort({
  conversationId,
  agentAdapter: adapter(async (cancelRequest) => {
    capturedRequests.push(cancelRequest);
  }),
  logger: new CollectingLogger(logs),
});

const mutableRequest = request(1);
const cancellation = port.cancel(mutableRequest);
mutableRequest.conversationId = "mutated-conversation";
mutableRequest.runId = "mutated-run";
mutableRequest.turnId = "mutated-turn";
mutableRequest.stopInput.id = "mutated-stop-input";
await cancellation;

assert.deepEqual(capturedRequests[0], {
  conversationId,
  runId: "run-1",
  turnId: "turn-1",
  reason: EXECUTION_CANCELLATION_REASON.stop,
});
assert.equal(Object.isFrozen(capturedRequests[0]), true);
assert.equal("stopInput" in capturedRequests[0], false);
assert.equal("forbiddenPayload" in capturedRequests[0], false);

await port.cancel(request(2, { turnId: undefined }));
assert.deepEqual(capturedRequests[1], {
  conversationId,
  runId: "run-2",
  reason: EXECUTION_CANCELLATION_REASON.stop,
});
assert.equal(Object.isFrozen(capturedRequests[1]), true);

const invalidRequests = [
  request(3, { conversationId: "different-conversation" }),
  request(4, { runId: "   " }),
  request(5, { turnId: "   " }),
  request(6, {
    stopInput: {
      id: "not-stop-input",
      eventType: INPUT_EVENT_TYPE.userMessage,
      sequence: 6,
    },
  }),
  request(7, { reason: EXECUTION_CANCELLATION_REASON.interrupt }),
];

for (const invalidRequest of invalidRequests) {
  await assert.rejects(
    () => port.cancel(invalidRequest),
    (error) =>
      error instanceof AgentRuntimeStopCancellationPortError &&
      error.conversationId === conversationId &&
      error.runId === undefined &&
      error.failure === AGENT_RUNTIME_STOP_CANCELLATION_FAILURE.invalidRequest,
  );
}
assert.equal(capturedRequests.length, 2);

const failingLogs = [];
const failingPort = new AgentRuntimeStopCancellationPort({
  conversationId,
  agentAdapter: adapter(async () => {
    throw new Error(
      "FORBIDDEN_ADAPTER_ERROR FORBIDDEN_WORK_PATH FORBIDDEN_NOVEL_TEXT",
    );
  }),
  logger: new CollectingLogger(failingLogs),
});
await assert.rejects(
  () => failingPort.cancel(request(8)),
  (error) =>
    error instanceof AgentRuntimeStopCancellationPortError &&
    error.conversationId === conversationId &&
    error.runId === "run-8" &&
    error.failure === AGENT_RUNTIME_STOP_CANCELLATION_FAILURE.adapterFailed &&
    error.cause === undefined,
);

const allLogs = JSON.stringify([...logs, ...failingLogs]);
for (const token of forbidden) assert.equal(allLogs.includes(token), false);
assert.equal(
  logs.some(
    (entry) =>
      entry.event === "runtime.agent_stop.cancellation_started" &&
      entry.fields.runId === "run-1" &&
      entry.fields.turnId === "turn-1" &&
      entry.fields.stopInputEventId === "stop-input-1" &&
      entry.fields.stopInputSequence === 1 &&
      entry.fields.hasTurn === true,
  ),
  true,
);
assert.equal(
  logs.some(
    (entry) =>
      entry.event === "runtime.agent_stop.cancellation_completed" &&
      entry.fields.runId === "run-2" &&
      entry.fields.hasTurn === false &&
      entry.fields.turnId === undefined,
  ),
  true,
);
assert.equal(
  failingLogs.some(
    (entry) =>
      entry.event === "runtime.agent_stop.cancellation_failed" &&
      entry.fields.failure ===
        AGENT_RUNTIME_STOP_CANCELLATION_FAILURE.adapterFailed &&
      entry.fields.runId === "run-8",
  ),
  true,
);
