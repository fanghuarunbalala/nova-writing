import assert from "node:assert/strict";
import { Agent } from "@earendil-works/pi-agent-core";
import {
  AGENT_RUNTIME_INVOCATION_KIND,
  AGENT_RUNTIME_OUTCOME,
  BaseContextCompiler,
  EXECUTION_CANCELLATION_REASON,
  OUTPUT_EVENT_TYPE,
  RUN_STATE_CHANGE_REASON,
  RUN_STATUS,
  TURN_STATE_CHANGE_REASON,
  TURN_STATUS,
  TurnController,
  coreEventSchemaRegistry,
} from "../dist/index.js";
import {
  CompositePiAgentEventBridge,
  CorePiRuntimeMessageConverter,
  PiAgentCoreAdapter,
  PiAssistantOutputBridge,
  PiTurnLifecycleBridge,
  asPiAgentCoreClient,
} from "../dist/runtime/agent/pi/index.js";

class FixedIdFactory {
  create(input) {
    const owner = input.scope === "turn" ? input.turnId : input.runId;
    return `evt-assistant-${input.eventType.replaceAll(".", "-")}-${owner}-${input.ordinal}`;
  }
}

class IncrementingClock {
  offset = 0;
  now() {
    const value = new Date(Date.UTC(2026, 7, 1, 10, 0, 0, this.offset));
    this.offset += 1;
    return value.toISOString();
  }
}

class RecordingSink {
  events = [];
  blockFirstDelta = false;
  firstDeltaReached;
  releaseFirstDelta;

  constructor() {
    this.firstDeltaReached = new Promise((resolve) => {
      this.markFirstDeltaReached = resolve;
    });
    this.firstDeltaBarrier = new Promise((resolve) => {
      this.releaseFirstDelta = resolve;
    });
  }

  async append(event) {
    coreEventSchemaRegistry.validateOutput(event.getSnapshot());
    this.events.push(event);
    if (
      this.blockFirstDelta &&
      event.getEventType() === OUTPUT_EVENT_TYPE.agentAssistantMessageDelta &&
      event.getPayload().toObject().deltaOrdinal === 0
    ) {
      this.markFirstDeltaReached();
      await this.firstDeltaBarrier;
    }
    return Object.freeze({
      status: "recorded",
      conversationId: event.conversationId,
      eventId: event.id,
      sequence: this.events.length,
      recordedAt: "2026-08-01T10:30:00.000Z",
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
    timestamp: "2026-08-01T10:00:00.000Z",
    payload: { content: [{ type: "text", text }] },
  };
}

const model = {
  id: "assistant-output-smoke",
  name: "Assistant Output Smoke",
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

function assistant(content, stopReason = "stop", errorMessage) {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    timestamp: Date.parse("2026-08-01T10:00:01.000Z"),
  };
}

function richCompletedStream(onAfterFirstDelta) {
  const thinking = { type: "thinking", thinking: "hidden plan" };
  const text = { type: "text", text: "chapter opening" };
  const finalMessage = assistant([thinking, text]);
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: assistant([]) };
      yield {
        type: "thinking_start",
        contentIndex: 0,
        partial: assistant([{ type: "thinking", thinking: "" }]),
      };
      yield {
        type: "thinking_delta",
        contentIndex: 0,
        delta: "hidden plan",
        partial: assistant([thinking]),
      };
      onAfterFirstDelta();
      yield {
        type: "text_start",
        contentIndex: 1,
        partial: assistant([thinking, { type: "text", text: "" }]),
      };
      yield {
        type: "text_delta",
        contentIndex: 1,
        delta: "chapter ",
        partial: assistant([thinking, { type: "text", text: "chapter " }]),
      };
      yield {
        type: "text_delta",
        contentIndex: 1,
        delta: "opening",
        partial: finalMessage,
      };
      yield { type: "done", reason: "stop", message: finalMessage };
    },
    result: async () => finalMessage,
  };
}

function errorStream(stopReason, errorMessage) {
  const finalMessage = assistant([], stopReason, errorMessage);
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "error", reason: stopReason, error: finalMessage };
    },
    result: async () => finalMessage,
  };
}

function cancelStream(signal, onDelta) {
  const partial = assistant([{ type: "text", text: "partial chapter" }]);
  const cancelled = assistant([], "aborted", "FORBIDDEN_PROVIDER_ERROR");
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: assistant([]) };
      yield {
        type: "text_delta",
        contentIndex: 0,
        delta: "partial chapter",
        partial,
      };
      onDelta();
      if (!signal.aborted) {
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      }
      yield { type: "error", reason: "aborted", error: cancelled };
    },
    result: async () => cancelled,
  };
}

// abort 先于 message_start：provider 在 abort 前不 yield 任何消息；stop 先把 turn 转
// stopping 再 dispatch cancel，aborted 的 message_start 到达桥时 turn 已非 running。
function abortBeforeStartStream(signal, onWaiting) {
  const cancelled = assistant([], "aborted", "FORBIDDEN_PROVIDER_ERROR");
  return {
    async *[Symbol.asyncIterator]() {
      onWaiting();
      if (!signal.aborted) {
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      }
      yield { type: "start", partial: assistant([]) };
      yield { type: "error", reason: "aborted", error: cancelled };
    },
    result: async () => cancelled,
  };
}

async function createRunningController(conversationId, runId, turnId, sink, logger) {
  const eventIdFactory = new FixedIdFactory();
  const controller = new TurnController({
    conversationId,
    eventIdFactory,
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
  return { controller, eventIdFactory };
}

function createBridge({ conversationId, controller, eventIdFactory, sink, logger, messageId }) {
  return new CompositePiAgentEventBridge([
    new PiTurnLifecycleBridge({
      conversationId,
      lifecycleController: controller,
      logger,
    }),
    new PiAssistantOutputBridge({
      conversationId,
      turnStateReader: controller,
      eventIdFactory,
      eventSink: sink,
      messageIdGenerator: { generate: () => messageId },
      clock: new IncrementingClock(),
      logger,
    }),
  ]);
}

const forbidden = [
  "FORBIDDEN_SYSTEM_PROMPT",
  "FORBIDDEN_USER_TEXT",
  "FORBIDDEN_PROVIDER_ERROR",
  "hidden plan",
  "chapter opening",
  "partial chapter",
];
const logs = [];
const logger = createLogger(logs);
const converter = new CorePiRuntimeMessageConverter({ logger });
const compiler = new BaseContextCompiler();

const completedSink = new RecordingSink();
completedSink.blockFirstDelta = true;
const completedRuntime = await createRunningController(
  "conversation-assistant-completed",
  "run-assistant-completed",
  "turn-assistant-completed",
  completedSink,
  logger,
);
let afterFirstDelta = false;
const completedAgent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  streamFn: async () => richCompletedStream(() => {
    afterFirstDelta = true;
  }),
});
const completedAdapter = new PiAgentCoreAdapter({
  agent: asPiAgentCoreClient(completedAgent),
  messageConverter: converter,
  eventBridge: createBridge({
    conversationId: "conversation-assistant-completed",
    controller: completedRuntime.controller,
    eventIdFactory: completedRuntime.eventIdFactory,
    sink: completedSink,
    logger,
    messageId: "assistant-message-completed",
  }),
  logger,
});
const completedContext = await compiler.compile({
  conversationId: "conversation-assistant-completed",
  runId: "run-assistant-completed",
  systemPrompt: "FORBIDDEN_SYSTEM_PROMPT",
  messages: [],
});
const completedRun = completedAdapter.stream({
  conversationId: completedContext.conversationId,
  runId: completedContext.runId,
  context: completedContext,
  invocation: {
    kind: AGENT_RUNTIME_INVOCATION_KIND.prompt,
    messages: [
      userMessage(
        "message-assistant-completed",
        completedContext.conversationId,
        "FORBIDDEN_USER_TEXT",
      ),
    ],
  },
});
await completedSink.firstDeltaReached;
assert.equal(afterFirstDelta, false);
completedSink.releaseFirstDelta();
const completedResult = await completedRun;
assert.equal(completedResult.outcome, AGENT_RUNTIME_OUTCOME.completed);
assert.equal(afterFirstDelta, true);
assert.equal(completedRuntime.controller.getTurnSnapshot().status, TURN_STATUS.completed);
const completedOutput = completedSink.events.filter((event) =>
  event.getEventType().startsWith("agent.assistant.message."),
);
assert.deepEqual(
  completedOutput.map((event) => event.getEventType()),
  [
    OUTPUT_EVENT_TYPE.agentAssistantMessageStarted,
    OUTPUT_EVENT_TYPE.agentAssistantMessageDelta,
    OUTPUT_EVENT_TYPE.agentAssistantMessageDelta,
    OUTPUT_EVENT_TYPE.agentAssistantMessageDelta,
    OUTPUT_EVENT_TYPE.agentAssistantMessageCompleted,
  ],
);
assert.deepEqual(
  completedOutput.at(-1).getPayload().toObject(),
  {
    assistantMessageId: "assistant-message-completed",
    content: [
      { type: "thinking", thinking: "hidden plan" },
      { type: "text", text: "chapter opening" },
    ],
    completionReason: "stop",
    hasToolCalls: false,
  },
);

const failedSink = new RecordingSink();
const failedRuntime = await createRunningController(
  "conversation-assistant-failed",
  "run-assistant-failed",
  "turn-assistant-failed",
  failedSink,
  logger,
);
const failedAdapter = new PiAgentCoreAdapter({
  agent: asPiAgentCoreClient(
    new Agent({
      initialState: { model, systemPrompt: "", messages: [], tools: [] },
      streamFn: async () => errorStream("error", "FORBIDDEN_PROVIDER_ERROR"),
    }),
  ),
  messageConverter: converter,
  eventBridge: createBridge({
    conversationId: "conversation-assistant-failed",
    controller: failedRuntime.controller,
    eventIdFactory: failedRuntime.eventIdFactory,
    sink: failedSink,
    logger,
    messageId: "assistant-message-failed",
  }),
  logger,
});
const failedContext = await compiler.compile({
  conversationId: "conversation-assistant-failed",
  runId: "run-assistant-failed",
  systemPrompt: "failed",
  messages: [
    userMessage("message-assistant-failed", "conversation-assistant-failed", "failed"),
  ],
});
const failedResult = await failedAdapter.stream({
  conversationId: failedContext.conversationId,
  runId: failedContext.runId,
  context: failedContext,
  invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
});
assert.equal(failedResult.outcome, AGENT_RUNTIME_OUTCOME.failed);
assert.equal(failedRuntime.controller.getTurnSnapshot().status, TURN_STATUS.failed);
assert.deepEqual(
  failedSink.events
    .filter((event) => event.getEventType().startsWith("agent.assistant.message."))
    .map((event) => event.getEventType()),
  [
    OUTPUT_EVENT_TYPE.agentAssistantMessageStarted,
    OUTPUT_EVENT_TYPE.agentAssistantMessageFailed,
  ],
);

const cancelledSink = new RecordingSink();
const cancelledRuntime = await createRunningController(
  "conversation-assistant-cancelled",
  "run-assistant-cancelled",
  "turn-assistant-cancelled",
  cancelledSink,
  logger,
);
let markCancelDelta;
const cancelDelta = new Promise((resolve) => {
  markCancelDelta = resolve;
});
const cancelledAdapter = new PiAgentCoreAdapter({
  agent: asPiAgentCoreClient(
    new Agent({
      initialState: { model, systemPrompt: "", messages: [], tools: [] },
      streamFn: async (_model, _context, options) =>
        cancelStream(options.signal, markCancelDelta),
    }),
  ),
  messageConverter: converter,
  eventBridge: createBridge({
    conversationId: "conversation-assistant-cancelled",
    controller: cancelledRuntime.controller,
    eventIdFactory: cancelledRuntime.eventIdFactory,
    sink: cancelledSink,
    logger,
    messageId: "assistant-message-cancelled",
  }),
  logger,
});
const cancelledContext = await compiler.compile({
  conversationId: "conversation-assistant-cancelled",
  runId: "run-assistant-cancelled",
  systemPrompt: "cancelled",
  messages: [
    userMessage(
      "message-assistant-cancelled",
      "conversation-assistant-cancelled",
      "cancelled",
    ),
  ],
});
const cancelledRun = cancelledAdapter.stream({
  conversationId: cancelledContext.conversationId,
  runId: cancelledContext.runId,
  context: cancelledContext,
  invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
});
await cancelDelta;
await cancelledRuntime.controller.transitionTurn({
  current: TURN_STATUS.stopping,
  reason: TURN_STATE_CHANGE_REASON.stopRequested,
});
await cancelledRuntime.controller.transitionRun({
  current: RUN_STATUS.stopping,
  reason: RUN_STATE_CHANGE_REASON.stopRequested,
});
await cancelledAdapter.cancel({
  conversationId: cancelledContext.conversationId,
  runId: cancelledContext.runId,
  turnId: cancelledRuntime.controller.getTurnSnapshot().turnId,
  reason: EXECUTION_CANCELLATION_REASON.stop,
});
const cancelledResult = await cancelledRun;
assert.equal(cancelledResult.outcome, AGENT_RUNTIME_OUTCOME.cancelled);
assert.equal(cancelledRuntime.controller.getTurnSnapshot().status, TURN_STATUS.stopping);
const cancelledOutput = cancelledSink.events.filter((event) =>
  event.getEventType().startsWith("agent.assistant.message."),
);
assert.deepEqual(
  cancelledOutput.map((event) => event.getEventType()),
  [
    OUTPUT_EVENT_TYPE.agentAssistantMessageStarted,
    OUTPUT_EVENT_TYPE.agentAssistantMessageDelta,
    OUTPUT_EVENT_TYPE.agentAssistantMessageCancelled,
  ],
);
assert.equal(cancelledOutput[1].getPayload().toObject().delta, "partial chapter");
await cancelledRuntime.controller.transitionTurn({
  current: TURN_STATUS.cancelled,
  reason: TURN_STATE_CHANGE_REASON.cancellationCompleted,
  cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
});
await cancelledRuntime.controller.transitionRun({
  current: RUN_STATUS.cancelled,
  reason: RUN_STATE_CHANGE_REASON.cancellationCompleted,
  cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
});

// abort 先于 message_start 的取消：stop 已把 turn 转 stopping，aborted 的 message_start
// 才到达桥。修复前 startDraft 抛 turnState（crash 链起点）；修复后容忍 stopping turn，
// 落出 [Started, Cancelled]、outcome cancelled、无 throw。
const abortBeforeStartSink = new RecordingSink();
const abortBeforeStartRuntime = await createRunningController(
  "conversation-assistant-abort-before-start",
  "run-assistant-abort-before-start",
  "turn-assistant-abort-before-start",
  abortBeforeStartSink,
  logger,
);
let markAbortWaiting;
const abortWaiting = new Promise((resolve) => {
  markAbortWaiting = resolve;
});
const abortBeforeStartAdapter = new PiAgentCoreAdapter({
  agent: asPiAgentCoreClient(
    new Agent({
      initialState: { model, systemPrompt: "", messages: [], tools: [] },
      streamFn: async (_model, _context, options) =>
        abortBeforeStartStream(options.signal, markAbortWaiting),
    }),
  ),
  messageConverter: converter,
  eventBridge: createBridge({
    conversationId: "conversation-assistant-abort-before-start",
    controller: abortBeforeStartRuntime.controller,
    eventIdFactory: abortBeforeStartRuntime.eventIdFactory,
    sink: abortBeforeStartSink,
    logger,
    messageId: "assistant-message-abort-before-start",
  }),
  logger,
});
const abortBeforeStartContext = await compiler.compile({
  conversationId: "conversation-assistant-abort-before-start",
  runId: "run-assistant-abort-before-start",
  systemPrompt: "abort before start",
  messages: [
    userMessage(
      "message-assistant-abort-before-start",
      "conversation-assistant-abort-before-start",
      "abort before start",
    ),
  ],
});
const abortBeforeStartRun = abortBeforeStartAdapter.stream({
  conversationId: abortBeforeStartContext.conversationId,
  runId: abortBeforeStartContext.runId,
  context: abortBeforeStartContext,
  invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
});
await abortWaiting;
await abortBeforeStartRuntime.controller.transitionTurn({
  current: TURN_STATUS.stopping,
  reason: TURN_STATE_CHANGE_REASON.stopRequested,
});
await abortBeforeStartRuntime.controller.transitionRun({
  current: RUN_STATUS.stopping,
  reason: RUN_STATE_CHANGE_REASON.stopRequested,
});
await abortBeforeStartAdapter.cancel({
  conversationId: abortBeforeStartContext.conversationId,
  runId: abortBeforeStartContext.runId,
  turnId: abortBeforeStartRuntime.controller.getTurnSnapshot().turnId,
  reason: EXECUTION_CANCELLATION_REASON.stop,
});
const abortBeforeStartResult = await abortBeforeStartRun;
assert.equal(abortBeforeStartResult.outcome, AGENT_RUNTIME_OUTCOME.cancelled);
assert.equal(
  abortBeforeStartRuntime.controller.getTurnSnapshot().status,
  TURN_STATUS.stopping,
);
const abortBeforeStartOutput = abortBeforeStartSink.events.filter((event) =>
  event.getEventType().startsWith("agent.assistant.message."),
);
assert.deepEqual(
  abortBeforeStartOutput.map((event) => event.getEventType()),
  [
    OUTPUT_EVENT_TYPE.agentAssistantMessageStarted,
    OUTPUT_EVENT_TYPE.agentAssistantMessageCancelled,
  ],
);
await abortBeforeStartRuntime.controller.transitionTurn({
  current: TURN_STATUS.cancelled,
  reason: TURN_STATE_CHANGE_REASON.cancellationCompleted,
  cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
});
await abortBeforeStartRuntime.controller.transitionRun({
  current: RUN_STATUS.cancelled,
  reason: RUN_STATE_CHANGE_REASON.cancellationCompleted,
  cancellationReason: EXECUTION_CANCELLATION_REASON.stop,
});

const serializedLogs = JSON.stringify(logs);
for (const token of forbidden) assert.equal(serializedLogs.includes(token), false);
assert.equal(
  logs.some((record) => record.event === "runtime.agent.assistant_started"),
  true,
);
assert.equal(
  logs.some((record) => record.event === "runtime.agent.assistant_terminal"),
  true,
);
