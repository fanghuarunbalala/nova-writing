import assert from "node:assert/strict";
import { Agent } from "@earendil-works/pi-agent-core";
import {
  AgentAssistantMessageCompletedOutputEvent,
  CoreAssistantRuntimeMessageProjector,
  CoreConversationRuntimeMessageProjector,
  RUNTIME_MESSAGE_SCHEMA_VERSION,
  RuntimeMessageProjectionError,
  RuntimeMessageValidationError,
  createCoreRuntimeMessageSchemaRegistry,
} from "../dist/index.js";
import {
  CORE_PI_MESSAGE_CONVERSION_FAILURE,
  CorePiRuntimeMessageConversionError,
  CorePiRuntimeMessageConverter,
  PiAgentCoreAssistantMessageEnvelopeFactory,
  asPiAgentCoreClient,
} from "../dist/runtime/agent/pi/index.js";

const forbiddenText = "FORBIDDEN_ASSISTANT_HISTORY_TEXT";
const forbiddenThinking = "FORBIDDEN_ASSISTANT_THINKING";
const forbiddenProvider = "FORBIDDEN_PROVIDER_ID";
const logs = [];
const logger = createLogger(logs);
const conversationId = "conversation-assistant-history";
const runId = "run-assistant-history";
const turnId = "turn-assistant-history";

const completed = new AgentAssistantMessageCompletedOutputEvent({
  id: "output-assistant-completed",
  conversationId,
  runId,
  turnId,
  assistantMessageId: "assistant-message-history",
  timestamp: "2026-08-01T00:00:01.000Z",
  content: [
    { type: "thinking", thinking: forbiddenThinking },
    { type: "text", text: forbiddenText },
    { type: "text", text: "" },
    { type: "text", text: "second text block" },
  ],
  completionReason: "stop",
  hasToolCalls: false,
});
const persistedCompleted = persistOutput(completed.getSnapshot(), 2);
const assistantProjector = new CoreAssistantRuntimeMessageProjector();
const projected = assistantProjector.project(persistedCompleted);

assert.deepEqual(projected, [
  {
    role: "assistant",
    messageType: "assistant.message",
    schemaVersion: RUNTIME_MESSAGE_SCHEMA_VERSION,
    timestamp: "2026-08-01T00:00:01.000Z",
    runId,
    turnId,
    payload: {
      content: [
        { type: "text", text: forbiddenText },
        { type: "text", text: "second text block" },
      ],
    },
  },
]);

const registry = createCoreRuntimeMessageSchemaRegistry();
assert.deepEqual(registry.validateDraft(projected[0]), projected[0]);
assert.throws(
  () =>
    registry.validateDraft({
      ...projected[0],
      payload: {
        content: [{ type: "thinking", thinking: forbiddenThinking }],
      },
    }),
  RuntimeMessageValidationError,
);
assert.throws(
  () =>
    registry.validateDraft({
      ...projected[0],
      payload: {
        ...projected[0].payload,
        provider: forbiddenProvider,
      },
    }),
  RuntimeMessageValidationError,
);

const toolCompleted = new AgentAssistantMessageCompletedOutputEvent({
  id: "output-assistant-tool-completed",
  conversationId,
  runId,
  turnId,
  assistantMessageId: "assistant-message-tool-history",
  timestamp: "2026-08-01T00:00:02.000Z",
  content: [{ type: "text", text: "tool preface" }],
  completionReason: "tool_use",
  hasToolCalls: true,
});
assert.deepEqual(assistantProjector.project(persistOutput(toolCompleted.getSnapshot(), 3)), []);
assert.throws(
  () =>
    assistantProjector.project({
      ...persistedCompleted,
      runId: undefined,
    }),
  RuntimeMessageProjectionError,
);

const standardProjector = new CoreConversationRuntimeMessageProjector({ logger });
assert.equal(standardProjector.id, "core.conversation-message");
assert.equal(standardProjector.version, "1");
assert.deepEqual(standardProjector.project(persistedCompleted), projected);

const model = createModel("smoke-model", "openai-completions", "openai");
const agent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  streamFn: async () => {
    throw new Error("unused smoke stream");
  },
});
const converter = new CorePiRuntimeMessageConverter({
  assistantMessageEnvelopeFactory: new PiAgentCoreAssistantMessageEnvelopeFactory(
    asPiAgentCoreClient(agent),
  ),
  logger,
});
const canonicalAssistant = {
  id: "runtime-assistant-message",
  conversationId,
  ...projected[0],
};
const converted = await converter.convert({
  conversationId,
  runId,
  purpose: "context",
  messages: [canonicalAssistant],
});
assert.deepEqual(converted, [
  {
    role: "assistant",
    content: [
      { type: "text", text: forbiddenText },
      { type: "text", text: "second text block" },
    ],
    api: "openai-completions",
    provider: "openai",
    model: "smoke-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop",
    timestamp: Date.parse(canonicalAssistant.timestamp),
  },
]);
assert.equal(Object.isFrozen(converted), true);
assert.equal(Object.isFrozen(converted[0]), true);
assert.equal(Object.isFrozen(converted[0].content), true);
assert.equal(Object.isFrozen(converted[0].usage), true);
assert.equal(Object.isFrozen(converted[0].usage.cost), true);

agent.state.model = createModel("replacement-model", "anthropic-messages", "anthropic");
const replacement = await converter.convert({
  conversationId,
  runId: "run-assistant-history-replacement",
  purpose: "context",
  messages: [{ ...canonicalAssistant, id: "runtime-assistant-message-replacement" }],
});
assert.equal(replacement[0].api, "anthropic-messages");
assert.equal(replacement[0].provider, "anthropic");
assert.equal(replacement[0].model, "replacement-model");

const converterWithoutEnvelope = new CorePiRuntimeMessageConverter({ logger });
await assert.rejects(
  () =>
    converterWithoutEnvelope.convert({
      conversationId,
      runId,
      purpose: "context",
      messages: [canonicalAssistant],
    }),
  (error) =>
    error instanceof CorePiRuntimeMessageConversionError &&
    error.failure === CORE_PI_MESSAGE_CONVERSION_FAILURE.assistantEnvelopeUnavailable,
);
const invalidEnvelopeConverter = new CorePiRuntimeMessageConverter({
  assistantMessageEnvelopeFactory: {
    create: () => ({ api: "", provider: forbiddenProvider, model: "model" }),
  },
  logger,
});
await assert.rejects(
  () =>
    invalidEnvelopeConverter.convert({
      conversationId,
      runId,
      purpose: "context",
      messages: [canonicalAssistant],
    }),
  (error) =>
    error instanceof CorePiRuntimeMessageConversionError &&
    error.failure === CORE_PI_MESSAGE_CONVERSION_FAILURE.assistantEnvelopeInvalid,
);

const coreRoot = await import("../dist/index.js");
assert.equal("CorePiRuntimeMessageConverter" in coreRoot, false);
assert.equal("PiAgentCoreAssistantMessageEnvelopeFactory" in coreRoot, false);
const serializedLogs = JSON.stringify(logs);
for (const forbidden of [forbiddenText, forbiddenThinking, forbiddenProvider]) {
  assert.equal(serializedLogs.includes(forbidden), false);
}
assert.equal(serializedLogs.includes('"payload"'), false);

function persistOutput(snapshot, sequence) {
  return {
    ...snapshot,
    direction: "output",
    sequence,
    recordedAt: "2026-08-01T00:00:03.000Z",
  };
}

function createModel(id, api, provider) {
  return {
    id,
    name: id,
    api,
    provider,
    baseUrl: "https://invalid.example.test",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 1024,
  };
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

console.log("Task 3E-E Assistant Runtime Message history smoke passed");
