import assert from "node:assert/strict";
import { Agent } from "@earendil-works/pi-agent-core";
import {
  AGENT_RUNTIME_INVOCATION_KIND,
  AGENT_RUNTIME_OUTCOME,
  BaseContextCompiler,
  EXECUTION_CANCELLATION_REASON,
  RUN_STATE_CHANGE_REASON,
  RUN_STATUS,
  TURN_STATE_CHANGE_REASON,
  TURN_STATUS,
  TurnController,
} from "../dist/index.js";
import {
  CORE_PI_MESSAGE_CONVERSION_FAILURE,
  CorePiRuntimeMessageConversionError,
  CorePiRuntimeMessageConverter,
  PiAgentCoreAdapter,
  PiTurnLifecycleBridge,
  asPiAgentCoreClient,
} from "../dist/runtime/agent/pi/index.js";

class FixedIdFactory {
  create(input) {
    const owner = input.scope === "turn" ? input.turnId : input.runId;
    return `evt-pi-turn-${input.scope}-${owner}-${input.ordinal}`;
  }
}

class IncrementingClock {
  offset = 0;
  now() {
    const value = new Date(Date.UTC(2026, 7, 1, 9, 0, 0, this.offset));
    this.offset += 1;
    return value.toISOString();
  }
}

class BarrierSink {
  events = [];
  blockTurnStart = false;
  turnStartReached;
  releaseTurnStart;

  constructor() {
    this.turnStartReached = new Promise((resolve) => {
      this.markTurnStartReached = resolve;
    });
    this.turnStartBarrier = new Promise((resolve) => {
      this.releaseTurnStart = resolve;
    });
  }

  async append(event) {
    this.events.push(event);
    if (
      this.blockTurnStart &&
      event.getEventType() === "agent.turn.state.changed" &&
      event.getPayload().toObject().current === TURN_STATUS.running
    ) {
      this.markTurnStartReached();
      await this.turnStartBarrier;
    }
    return Object.freeze({
      status: "recorded",
      conversationId: event.conversationId,
      eventId: event.id,
      sequence: this.events.length,
      recordedAt: "2026-08-01T09:30:00.000Z",
    });
  }
}

function createLogger(records) {
  const logger = {
    debug: (event, fields) => records.push({ level: "debug", event, fields }),
    info: (event, fields) => records.push({ level: "info", event, fields }),
    warn: (event, fields) => records.push({ level: "warn", event, fields }),
    error: (event, fields) => records.push({ level: "error", event, fields }),
    child: () => logger,
  };
  return logger;
}

function userMessage(id, conversationId, text) {
  return {
    id,
    conversationId,
    role: "user",
    messageType: "user.message",
    schemaVersion: 1,
    timestamp: "2026-08-01T09:00:00.000Z",
    payload: { content: [{ type: "text", text }] },
  };
}

const model = {
  id: "pi-turn-smoke",
  name: "Pi Turn Smoke",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://invalid.example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192,
  maxTokens: 1024,
};

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(stopReason = "stop", errorMessage) {
  return {
    role: "assistant",
    content: [{ type: "text", text: "FORBIDDEN_ASSISTANT_TEXT" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    timestamp: Date.parse("2026-08-01T09:00:01.000Z"),
  };
}

function completedStream(finalMessage = assistant()) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: finalMessage };
      if (finalMessage.stopReason === "error" || finalMessage.stopReason === "aborted") {
        yield { type: "error", reason: finalMessage.stopReason, error: finalMessage };
      } else {
        yield { type: "done", reason: finalMessage.stopReason, message: finalMessage };
      }
    },
    result: async () => finalMessage,
  };
}

function abortableStream(signal) {
  const finalMessage = assistant("aborted", "FORBIDDEN_PROVIDER_ERROR");
  return {
    async *[Symbol.asyncIterator]() {
      if (!signal.aborted) {
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      }
      yield { type: "error", reason: "aborted", error: finalMessage };
    },
    result: async () => finalMessage,
  };
}

async function createRunningController(conversationId, runId, turnId, sink, logger) {
  const controller = new TurnController({
    conversationId,
    eventIdFactory: new FixedIdFactory(),
    eventSink: sink,
    runIdGenerator: { generate: () => runId },
    turnIdGenerator: { generate: () => turnId },
    clock: new IncrementingClock(),
    logger,
  });
  await controller.beginRun({
    inputEvent: { id: `input-${runId}`, eventType: "user.message", sequence: 1 },
  });
  await controller.transitionRun({
    current: RUN_STATUS.running,
    reason: RUN_STATE_CHANGE_REASON.executionStarted,
  });
  return controller;
}

const forbidden = [
  "FORBIDDEN_USER_TEXT",
  "FORBIDDEN_ASSISTANT_TEXT",
  "FORBIDDEN_PROVIDER_ERROR",
  "FORBIDDEN_SYSTEM_PROMPT",
];
const logs = [];
const logger = createLogger(logs);
const converter = new CorePiRuntimeMessageConverter({ logger });
const source = userMessage(
  "message-converter",
  "conversation-converter",
  "FORBIDDEN_USER_TEXT",
);
const converted = await converter.convert({
  conversationId: "conversation-converter",
  runId: "run-converter",
  purpose: "context",
  messages: [source],
});
assert.deepEqual(converted, [
  {
    role: "user",
    content: [{ type: "text", text: "FORBIDDEN_USER_TEXT" }],
    timestamp: Date.parse(source.timestamp),
  },
]);
assert.equal(Object.isFrozen(converted), true);
assert.equal(Object.isFrozen(converted[0]), true);
assert.equal(Object.isFrozen(converted[0].content), true);
source.payload.content[0].text = "mutated";
assert.equal(converted[0].content[0].text, "FORBIDDEN_USER_TEXT");
await assert.rejects(
  () =>
    converter.convert({
      conversationId: "conversation-converter",
      runId: "run-converter-unsupported",
      purpose: "context",
      messages: [{ ...userMessage("unsupported", "conversation-converter", "safe"), role: "custom" }],
    }),
  (error) =>
    error instanceof CorePiRuntimeMessageConversionError &&
    (error.failure === CORE_PI_MESSAGE_CONVERSION_FAILURE.invalidMessage ||
      error.failure === CORE_PI_MESSAGE_CONVERSION_FAILURE.unsupportedMessage),
);

const promptSink = new BarrierSink();
promptSink.blockTurnStart = true;
const promptController = await createRunningController(
  "conversation-turn-prompt",
  "run-turn-prompt",
  "turn-turn-prompt",
  promptSink,
  logger,
);
const promptBridge = new PiTurnLifecycleBridge({
  conversationId: "conversation-turn-prompt",
  lifecycleController: promptController,
  logger,
});
let providerCalled = false;
const promptAgent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  streamFn: async () => {
    providerCalled = true;
    return completedStream();
  },
});
const promptAdapter = new PiAgentCoreAdapter({
  agent: asPiAgentCoreClient(promptAgent),
  messageConverter: converter,
  eventBridge: promptBridge,
  logger,
});
const promptContext = await new BaseContextCompiler().compile({
  conversationId: "conversation-turn-prompt",
  runId: "run-turn-prompt",
  systemPrompt: "FORBIDDEN_SYSTEM_PROMPT",
  messages: [],
});
const promptRun = promptAdapter.stream({
  conversationId: promptContext.conversationId,
  runId: promptContext.runId,
  context: promptContext,
  invocation: {
    kind: AGENT_RUNTIME_INVOCATION_KIND.prompt,
    messages: [
      userMessage("message-turn-prompt", "conversation-turn-prompt", "prompt"),
    ],
  },
});
await promptSink.turnStartReached;
assert.equal(providerCalled, false);
assert.equal(promptController.getTurnSnapshot(), undefined);
promptSink.releaseTurnStart();
const promptResult = await promptRun;
assert.equal(promptResult.outcome, AGENT_RUNTIME_OUTCOME.completed);
assert.equal(providerCalled, true);
assert.equal(promptController.getTurnSnapshot().status, TURN_STATUS.completed);
assert.deepEqual(
  promptSink.events.slice(2).map((event) => event.getPayload().toObject().current),
  [TURN_STATUS.running, TURN_STATUS.completed],
);

const failureSink = new BarrierSink();
const failureController = await createRunningController(
  "conversation-turn-failure",
  "run-turn-failure",
  "turn-turn-failure",
  failureSink,
  logger,
);
const failureAdapter = new PiAgentCoreAdapter({
  agent: asPiAgentCoreClient(
    new Agent({
      initialState: { model, systemPrompt: "", messages: [], tools: [] },
      streamFn: async () => completedStream(assistant("error", "FORBIDDEN_PROVIDER_ERROR")),
    }),
  ),
  messageConverter: converter,
  eventBridge: new PiTurnLifecycleBridge({
    conversationId: "conversation-turn-failure",
    lifecycleController: failureController,
    logger,
  }),
  logger,
});
const failureContext = await new BaseContextCompiler().compile({
  conversationId: "conversation-turn-failure",
  runId: "run-turn-failure",
  systemPrompt: "failure",
  messages: [
    userMessage("message-turn-failure", "conversation-turn-failure", "failure"),
  ],
});
const failureResult = await failureAdapter.stream({
  conversationId: failureContext.conversationId,
  runId: failureContext.runId,
  context: failureContext,
  invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
});
assert.equal(failureResult.outcome, AGENT_RUNTIME_OUTCOME.failed);
assert.equal(failureController.getTurnSnapshot().status, TURN_STATUS.failed);

const cancelSink = new BarrierSink();
const cancelController = await createRunningController(
  "conversation-turn-cancel",
  "run-turn-cancel",
  "turn-turn-cancel",
  cancelSink,
  logger,
);
let markProviderStarted;
const providerStarted = new Promise((resolve) => {
  markProviderStarted = resolve;
});
const cancelAdapter = new PiAgentCoreAdapter({
  agent: asPiAgentCoreClient(
    new Agent({
      initialState: { model, systemPrompt: "", messages: [], tools: [] },
      streamFn: async (_model, _context, options) => {
        markProviderStarted();
        return abortableStream(options.signal);
      },
    }),
  ),
  messageConverter: converter,
  eventBridge: new PiTurnLifecycleBridge({
    conversationId: "conversation-turn-cancel",
    lifecycleController: cancelController,
    logger,
  }),
  logger,
});
const cancelContext = await new BaseContextCompiler().compile({
  conversationId: "conversation-turn-cancel",
  runId: "run-turn-cancel",
  systemPrompt: "cancel",
  messages: [userMessage("message-turn-cancel", "conversation-turn-cancel", "cancel")],
});
const cancelRun = cancelAdapter.stream({
  conversationId: cancelContext.conversationId,
  runId: cancelContext.runId,
  context: cancelContext,
  invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
});
await providerStarted;
await cancelController.transitionTurn({
  current: TURN_STATUS.stopping,
  reason: TURN_STATE_CHANGE_REASON.stopRequested,
});
await cancelController.transitionRun({
  current: RUN_STATUS.stopping,
  reason: RUN_STATE_CHANGE_REASON.stopRequested,
});
await cancelAdapter.cancel({
  conversationId: cancelContext.conversationId,
  runId: cancelContext.runId,
  turnId: cancelController.getTurnSnapshot().turnId,
  reason: EXECUTION_CANCELLATION_REASON.stop,
});
const cancelResult = await cancelRun;
assert.equal(cancelResult.outcome, AGENT_RUNTIME_OUTCOME.cancelled);
assert.equal(cancelController.getTurnSnapshot().status, TURN_STATUS.stopping);
await cancelController.transitionTurn({
  current: TURN_STATUS.cancelled,
  reason: TURN_STATE_CHANGE_REASON.cancellationCompleted,
  cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
});
await cancelController.transitionRun({
  current: RUN_STATUS.cancelled,
  reason: RUN_STATE_CHANGE_REASON.cancellationCompleted,
  cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
});

const serializedLogs = JSON.stringify(logs);
for (const token of forbidden) assert.equal(serializedLogs.includes(token), false);
assert.equal(
  logs.some((record) => record.event === "runtime.agent.turn_started"),
  true,
);
assert.equal(
  logs.some((record) => record.event === "runtime.agent.turn_terminal"),
  true,
);
