import assert from "node:assert/strict";
import { Agent } from "@earendil-works/pi-agent-core";
import {
  AGENT_RUNTIME_INVOCATION_KIND,
  AGENT_RUNTIME_OUTCOME,
  BaseContextCompiler,
  EXECUTION_CANCELLATION_REASON,
} from "../dist/index.js";
import {
  PI_AGENT_CORE_ADAPTER_FAILURE,
  PiAgentCoreAdapter,
  PiAgentCoreAdapterError,
  asPiAgentCoreClient,
} from "../dist/runtime/agent/pi/index.js";

const forbidden = [
  "FORBIDDEN_SYSTEM_PROMPT",
  "FORBIDDEN_NOVEL_TEXT",
  "FORBIDDEN_PROVIDER_ERROR",
  "FORBIDDEN_EVENT_ERROR",
  "FORBIDDEN_WORK_PATH",
];

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
    timestamp: "2026-08-01T00:00:00.000Z",
    payload: { content: [{ type: "text", text }] },
  };
}

function piUserMessage(message) {
  return {
    role: "user",
    content: message.payload.content.map((item) => ({ ...item })),
    timestamp: Date.parse(message.timestamp),
  };
}

const model = {
  id: "smoke-model",
  name: "Smoke Model",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://invalid.example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192,
  maxTokens: 1024,
};

const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistantMessage(stopReason = "stop", errorMessage) {
  return {
    role: "assistant",
    content: [{ type: "text", text: "assistant response" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage,
    stopReason,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    timestamp: Date.parse("2026-08-01T00:00:01.000Z"),
  };
}

function completedStream(finalMessage = assistantMessage()) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: finalMessage };
      if (finalMessage.stopReason === "error" || finalMessage.stopReason === "aborted") {
        yield {
          type: "error",
          reason: finalMessage.stopReason,
          error: finalMessage,
        };
      } else {
        yield { type: "done", reason: finalMessage.stopReason, message: finalMessage };
      }
    },
    result: async () => finalMessage,
  };
}

function abortableStream(signal) {
  const finalMessage = assistantMessage("aborted", "FORBIDDEN_PROVIDER_ERROR");
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

// abort 后先 yield start（产生 message_start）再 yield error（terminal aborted）：
// 保证取消期间桥会收到 message_start。
function cancelWithMessageStartStream(signal) {
  const finalMessage = assistantMessage("aborted", "FORBIDDEN_PROVIDER_ERROR");
  return {
    async *[Symbol.asyncIterator]() {
      if (!signal.aborted) {
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      }
      yield { type: "start", partial: assistantMessage() };
      yield { type: "error", reason: "aborted", error: finalMessage };
    },
    result: async () => finalMessage,
  };
}

const compiler = new BaseContextCompiler();
const messageConverter = {
  convert: async ({ messages }) => messages.map(piUserMessage),
};

const promptLogs = [];
const promptEvents = [];
let releaseTurnStart;
const turnStartBarrier = new Promise((resolve) => {
  releaseTurnStart = resolve;
});
const promptAgent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  streamFn: async () => completedStream(),
});
const promptAdapter = new PiAgentCoreAdapter({
  agent: asPiAgentCoreClient(promptAgent),
  messageConverter,
  eventBridge: {
    handle: async ({ event }) => {
      promptEvents.push(event.type);
      if (event.type === "turn_start") await turnStartBarrier;
    },
  },
  logger: createLogger(promptLogs),
});
const promptContext = await compiler.compile({
  conversationId: "conversation-pi-prompt",
  runId: "run-pi-prompt",
  systemPrompt: "FORBIDDEN_SYSTEM_PROMPT FORBIDDEN_WORK_PATH",
  messages: [],
});
let promptSettled = false;
const promptPromise = promptAdapter
  .stream({
    conversationId: promptContext.conversationId,
    runId: promptContext.runId,
    context: promptContext,
    invocation: {
      kind: AGENT_RUNTIME_INVOCATION_KIND.prompt,
      messages: [
        userMessage(
          "message-pi-prompt",
          promptContext.conversationId,
          "FORBIDDEN_NOVEL_TEXT",
        ),
      ],
    },
  })
  .finally(() => {
    promptSettled = true;
  });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(promptSettled, false);
assert.deepEqual(promptEvents, ["agent_start", "turn_start"]);
releaseTurnStart();
const promptResult = await promptPromise;
assert.equal(promptResult.outcome, AGENT_RUNTIME_OUTCOME.completed);
assert.deepEqual(promptEvents, [
  "agent_start",
  "turn_start",
  "message_start",
  "message_end",
  "message_start",
  "message_end",
  "turn_end",
  "agent_end",
]);
assert.equal(promptAgent.state.messages.length, 2);

const continueEvents = [];
const continueAgent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  streamFn: async () => completedStream(),
});
const continueAdapter = new PiAgentCoreAdapter({
  agent: continueAgent,
  messageConverter,
  eventBridge: {
    handle: async ({ event }) => continueEvents.push(event.type),
  },
});
const continueContext = await compiler.compile({
  conversationId: "conversation-pi-continue",
  runId: "run-pi-continue",
  systemPrompt: "continue prompt",
  messages: [
    userMessage("message-pi-continue", "conversation-pi-continue", "continue text"),
  ],
});
const continueResult = await continueAdapter.stream({
  conversationId: continueContext.conversationId,
  runId: continueContext.runId,
  context: continueContext,
  invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
});
assert.equal(continueResult.outcome, AGENT_RUNTIME_OUTCOME.completed);
assert.equal(continueEvents.filter((event) => event === "message_start").length, 1);
assert.equal(continueAgent.state.messages.length, 2);

const failureAgent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  streamFn: async () =>
    completedStream(assistantMessage("error", "FORBIDDEN_PROVIDER_ERROR")),
});
const failureAdapter = new PiAgentCoreAdapter({
  agent: failureAgent,
  messageConverter,
  eventBridge: { handle: async () => undefined },
});
const failureContext = await compiler.compile({
  conversationId: "conversation-pi-failure",
  runId: "run-pi-failure",
  systemPrompt: "failure prompt",
  messages: [userMessage("message-pi-failure", "conversation-pi-failure", "failure")],
});
const failureResult = await failureAdapter.stream({
  conversationId: failureContext.conversationId,
  runId: failureContext.runId,
  context: failureContext,
  invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
});
assert.equal(failureResult.outcome, AGENT_RUNTIME_OUTCOME.failed);

let releaseConversion;
const conversionBarrier = new Promise((resolve) => {
  releaseConversion = resolve;
});
const preparingAgent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  streamFn: async () => completedStream(),
});
const preparingAdapter = new PiAgentCoreAdapter({
  agent: preparingAgent,
  messageConverter: {
    convert: async ({ messages }) => {
      await conversionBarrier;
      return messages.map(piUserMessage);
    },
  },
  eventBridge: { handle: async () => undefined },
});
const preparingContext = await compiler.compile({
  conversationId: "conversation-pi-preparing",
  runId: "run-pi-preparing",
  systemPrompt: "preparing prompt",
  messages: [
    userMessage("message-pi-preparing", "conversation-pi-preparing", "preparing"),
  ],
});
const preparingStream = preparingAdapter.stream({
  conversationId: preparingContext.conversationId,
  runId: preparingContext.runId,
  context: preparingContext,
  invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
});
await assert.rejects(
  () =>
    preparingAdapter.stream({
      conversationId: preparingContext.conversationId,
      runId: "run-pi-preparing-second",
      context: {
        ...preparingContext,
        runId: "run-pi-preparing-second",
      },
      invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
    }),
  (error) =>
    error instanceof PiAgentCoreAdapterError &&
    error.failure === PI_AGENT_CORE_ADAPTER_FAILURE.activeRun,
);
let preparingCancelSettled = false;
const preparingCancel = preparingAdapter
  .cancel({
    conversationId: preparingContext.conversationId,
    runId: preparingContext.runId,
    reason: EXECUTION_CANCELLATION_REASON.stop,
  })
  .finally(() => {
    preparingCancelSettled = true;
  });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(preparingCancelSettled, false);
releaseConversion();
const preparingResult = await preparingStream;
await preparingCancel;
assert.equal(preparingResult.outcome, AGENT_RUNTIME_OUTCOME.cancelled);
assert.equal(preparingAgent.state.messages.length, 0);

const cancelLogs = [];
const cancelAgent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  streamFn: async (_model, _context, options) => abortableStream(options.signal),
});
const cancelAdapter = new PiAgentCoreAdapter({
  agent: cancelAgent,
  messageConverter,
  eventBridge: { handle: async () => undefined },
  logger: createLogger(cancelLogs),
});
const cancelContext = await compiler.compile({
  conversationId: "conversation-pi-cancel",
  runId: "run-pi-cancel",
  systemPrompt: "cancel prompt",
  messages: [userMessage("message-pi-cancel", "conversation-pi-cancel", "cancel")],
});
const cancelStream = cancelAdapter.stream({
  conversationId: cancelContext.conversationId,
  runId: cancelContext.runId,
  context: cancelContext,
  invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
});
await new Promise((resolve) => setTimeout(resolve, 0));
const cancelRequest = {
  conversationId: cancelContext.conversationId,
  runId: cancelContext.runId,
  reason: EXECUTION_CANCELLATION_REASON.stop,
};
await Promise.all([cancelAdapter.cancel(cancelRequest), cancelAdapter.cancel(cancelRequest)]);
const cancelResult = await cancelStream;
assert.equal(cancelResult.outcome, AGENT_RUNTIME_OUTCOME.cancelled);
await cancelAdapter.cancel(cancelRequest);

// 取消期间桥在 message_start 上抛错：Fix 2 应吞掉（event_barrier_deferred_cancellation）
// 并让 outcome 落为 cancelled，而非 reject eventBarrier（修复前 reject）。
const cancelBridgeLogs = [];
const cancelBridgeAgent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  streamFn: async (_model, _context, options) =>
    cancelWithMessageStartStream(options.signal),
});
const cancelBridgeAdapter = new PiAgentCoreAdapter({
  agent: cancelBridgeAgent,
  messageConverter,
  eventBridge: {
    handle: async ({ event }) => {
      if (event.type === "message_start") {
        throw new Error("FORBIDDEN_EVENT_ERROR");
      }
    },
  },
  logger: createLogger(cancelBridgeLogs),
});
const cancelBridgeContext = await compiler.compile({
  conversationId: "conversation-pi-cancel-bridge",
  runId: "run-pi-cancel-bridge",
  systemPrompt: "cancel bridge prompt",
  messages: [
    userMessage(
      "message-pi-cancel-bridge",
      "conversation-pi-cancel-bridge",
      "cancel bridge",
    ),
  ],
});
const cancelBridgeStream = cancelBridgeAdapter.stream({
  conversationId: cancelBridgeContext.conversationId,
  runId: cancelBridgeContext.runId,
  context: cancelBridgeContext,
  invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
});
await new Promise((resolve) => setTimeout(resolve, 0));
await cancelBridgeAdapter.cancel({
  conversationId: cancelBridgeContext.conversationId,
  runId: cancelBridgeContext.runId,
  reason: EXECUTION_CANCELLATION_REASON.stop,
});
const cancelBridgeResult = await cancelBridgeStream;
assert.equal(cancelBridgeResult.outcome, AGENT_RUNTIME_OUTCOME.cancelled);
assert.equal(
  cancelBridgeLogs.some(
    (record) => record.event === "runtime.agent.event_barrier_deferred_cancellation",
  ),
  true,
);

const bridgeLogs = [];
const bridgeAgent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  streamFn: async () => completedStream(),
});
const bridgeAdapter = new PiAgentCoreAdapter({
  agent: bridgeAgent,
  messageConverter,
  eventBridge: {
    handle: async () => {
      throw new Error("FORBIDDEN_EVENT_ERROR");
    },
  },
  logger: createLogger(bridgeLogs),
});
const bridgeContext = await compiler.compile({
  conversationId: "conversation-pi-bridge",
  runId: "run-pi-bridge",
  systemPrompt: "bridge prompt",
  messages: [userMessage("message-pi-bridge", "conversation-pi-bridge", "bridge")],
});
await assert.rejects(
  () =>
    bridgeAdapter.stream({
      conversationId: bridgeContext.conversationId,
      runId: bridgeContext.runId,
      context: bridgeContext,
      invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
    }),
  (error) =>
    error instanceof PiAgentCoreAdapterError &&
    error.failure === PI_AGENT_CORE_ADAPTER_FAILURE.eventBarrier &&
    !error.message.includes("FORBIDDEN"),
);

const serializedLogs = JSON.stringify([
  ...promptLogs,
  ...cancelLogs,
  ...cancelBridgeLogs,
  ...bridgeLogs,
]);
for (const token of forbidden) assert.equal(serializedLogs.includes(token), false);
assert.equal(
  promptLogs.some((record) => record.event === "runtime.agent.stream_completed"),
  true,
);
assert.equal(
  cancelLogs.some((record) => record.event === "runtime.agent.cancel_completed"),
  true,
);
