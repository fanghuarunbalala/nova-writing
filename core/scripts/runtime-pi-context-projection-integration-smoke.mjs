import assert from "node:assert/strict";
import { Agent } from "@earendil-works/pi-agent-core";
import {
  AGENT_RUNTIME_INVOCATION_KIND,
  AGENT_RUNTIME_OUTCOME,
  ARTIFACT_REFERENCE_SCHEMA_VERSION,
  BaseContextCompiler,
  CONTEXT_CHECKPOINT_ITEM_PRIORITY,
  CONTEXT_CHECKPOINT_SCHEMA_VERSION,
  CONTEXT_PIN_GROUP_KIND,
  CONTEXT_PIN_LIFETIME,
  ContextProjectionProviderCallCoordinator,
} from "../dist/index.js";
import {
  PI_AGENT_CORE_ADAPTER_FAILURE,
  PiAgentCoreAdapter,
  PiAgentCoreAdapterError,
} from "../dist/runtime/agent/pi/index.js";

const privateMarker = "PRIVATE_PI_PROJECTION_CONTENT_MUST_NOT_APPEAR";
const baseSystemPrompt = "BASE_SYSTEM_PROMPT";
const checkpointSummary = `${privateMarker}:checkpoint-summary`;
const nudgeContent = `${privateMarker}:one-shot-nudge`;
const logs = [];
const logger = {
  debug: (event, fields = {}) => logs.push({ level: "debug", event, fields }),
  info: (event, fields = {}) => logs.push({ level: "info", event, fields }),
  warn: (event, fields = {}) => logs.push({ level: "warn", event, fields }),
  error: (event, fields = {}) => logs.push({ level: "error", event, fields }),
  child: () => logger,
};

const model = {
  id: "projection-smoke-model",
  name: "Projection Smoke Model",
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

function assistantMessage(content, stopReason = "stop") {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage,
    stopReason,
    timestamp: Date.parse("2026-08-02T05:00:10.000Z"),
  };
}

function completedStream(finalMessage) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: finalMessage };
      yield {
        type: "done",
        reason: finalMessage.stopReason,
        message: finalMessage,
      };
    },
    result: async () => finalMessage,
  };
}

function runtimeUserMessage(id, text, timestamp) {
  return {
    id,
    conversationId: "conversation-projection",
    role: "user",
    messageType: "user.message",
    schemaVersion: 1,
    timestamp,
    runId: "run-projection",
    payload: { content: [{ type: "text", text }] },
  };
}

const messageConverter = {
  async convert({ messages }) {
    return messages.map((message) => ({
      role: "user",
      content: message.payload.content.map((item) => ({ ...item })),
      timestamp: Date.parse(message.timestamp),
    }));
  },
};

const digest = `sha256:${"b".repeat(64)}`;
const checkpoint = {
  schemaVersion: CONTEXT_CHECKPOINT_SCHEMA_VERSION,
  id: "checkpoint-projection",
  conversationId: "conversation-projection",
  sourceStartSequence: 1,
  sourceEndSequence: 20,
  coveredThroughSequence: 20,
  sourceDigest: digest,
  summary: checkpointSummary,
  facts: [
    {
      id: "critical-memory",
      text: `${privateMarker}:critical-memory`,
      priority: CONTEXT_CHECKPOINT_ITEM_PRIORITY.critical,
      sourceMessageIds: ["source-critical"],
      artifactReferences: [],
    },
  ],
  decisions: [],
  constraints: [
    {
      id: "low-memory",
      text: `${privateMarker}:low-memory`,
      priority: CONTEXT_CHECKPOINT_ITEM_PRIORITY.low,
      sourceMessageIds: ["source-low"],
      artifactReferences: [
        {
          schemaVersion: ARTIFACT_REFERENCE_SCHEMA_VERSION,
          artifactId: "artifact-projection",
          conversationId: "conversation-projection",
          contentType: "text/plain",
          byteLength: 512,
          tokenEstimate: 128,
          digest,
          filename: "projection-detail.txt",
        },
      ],
    },
  ],
  unresolvedTasks: [],
  pinnedMessageIds: ["message-current"],
  recentWindowStartSequence: 21,
  tokenEstimateBefore: 1_000,
  tokenEstimateAfter: 400,
  compactorId: "compactor-projection",
  compactorVersion: "1",
  createdAt: "2026-08-02T05:00:00.000Z",
  contentDigest: digest,
};

const projectionRequests = [];
const projectionCoordinator = new ContextProjectionProviderCallCoordinator({
  candidateProvider: {
    async load(request) {
      projectionRequests.push(request);
      return {
        conversationId: request.conversationId,
        providerCallId: request.providerCallId,
        checkpoint,
        pinnedGroups: [
          {
            id: "pin-current-input",
            conversationId: request.conversationId,
            kind: CONTEXT_PIN_GROUP_KIND.currentInput,
            lifetime: CONTEXT_PIN_LIFETIME.sliding,
            messageIds: ["message-current"],
            tokenEstimate: 50,
            runId: request.runId,
            turnId: "turn-current",
          },
        ],
        recentMessageIds: ["message-old-1", "message-old-2"],
        transientMessageCount: request.transientMessageCount,
        nonMessageFixedTokens: 100,
        checkpointBaseTokens: 50,
        checkpointItemTokenEstimates: [
          { itemId: "critical-memory", tokenEstimate: 100 },
          { itemId: "low-memory", tokenEstimate: 50 },
        ],
        messageTokenEstimates: [
          { messageId: "message-current", tokenEstimate: 50 },
          { messageId: "message-old-1", tokenEstimate: 60 },
          { messageId: "message-old-2", tokenEstimate: 60 },
        ],
        transientMessageTokens: request.transientMessageCount * 40,
        hardAdmissionTokens: 400,
      };
    },
  },
  logger,
});

const nudgeRequests = [];
const nudgeConfirmations = [];
const nudgeCoordinator = {
  async prepare(request) {
    nudgeRequests.push(request);
    if (request.providerCallId !== "provider-call-1") return undefined;
    return {
      conversationId: request.conversationId,
      runId: request.runId,
      providerCallId: request.providerCallId,
      lease: {
        leaseId: "lease-projection",
        providerCallId: request.providerCallId,
        targetRunId: request.runId,
        targetTurnNumber: request.targetTurnNumber,
        nudgeIds: ["nudge-projection"],
        leasedAt: request.requestedAt,
      },
      overlay: {
        placement: "system-prompt-overlay",
        nudgeIds: ["nudge-projection"],
        content: nudgeContent,
      },
    };
  },
  async confirmDispatched(prepared) {
    nudgeConfirmations.push(prepared.providerCallId);
    return { confirmation: { status: "consumed" }, eventReceipts: [] };
  },
  async releaseBeforeDispatch() {
    throw new Error("release should not run in successful projection smoke");
  },
};

const providerContexts = [];
let providerCallCount = 0;
const agent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  streamFn: async () => {
    throw new Error("adapter must install the projected StreamFn");
  },
});
const adapter = new PiAgentCoreAdapter({
  agent,
  messageConverter,
  eventBridge: { handle: async () => undefined },
  contextProjectionProviderCalls: projectionCoordinator,
  nudgeProviderCalls: nudgeCoordinator,
  dispatchAwareStreamFunction: async (_model, context, _options, hooks) => {
    providerCallCount += 1;
    providerContexts.push(structuredClone(context));
    await hooks.onDispatched(
      `2026-08-02T05:00:0${providerCallCount + 1}.000Z`,
    );
    if (providerCallCount === 1) {
      return completedStream(
        assistantMessage(
          [
            {
              type: "toolCall",
              id: "tool-call-projection",
              name: "missing_tool",
              arguments: {},
            },
          ],
          "toolUse",
        ),
      );
    }
    return completedStream(
      assistantMessage([{ type: "text", text: "final answer" }]),
    );
  },
  providerCallIdFactory: {
    create: ({ providerCallOrdinal }) => `provider-call-${providerCallOrdinal}`,
  },
  providerCallClock: { now: () => "2026-08-02T05:00:01.000Z" },
  logger,
});

const compiler = new BaseContextCompiler();
const context = await compiler.compile({
  conversationId: "conversation-projection",
  runId: "run-projection",
  systemPrompt: baseSystemPrompt,
  messages: [
    runtimeUserMessage(
      "message-old-1",
      "CANONICAL_OLD_1",
      "2026-08-02T05:00:01.000Z",
    ),
    runtimeUserMessage(
      "message-old-2",
      "CANONICAL_OLD_2",
      "2026-08-02T05:00:02.000Z",
    ),
  ],
});
const result = await adapter.stream({
  conversationId: context.conversationId,
  runId: context.runId,
  context,
  invocation: {
    kind: AGENT_RUNTIME_INVOCATION_KIND.prompt,
    messages: [
      runtimeUserMessage(
        "message-current",
        "CANONICAL_CURRENT_INPUT",
        "2026-08-02T05:00:03.000Z",
      ),
    ],
  },
});

assert.equal(result.outcome, AGENT_RUNTIME_OUTCOME.completed);
assert.equal(providerCallCount, 2);
assert.deepEqual(
  projectionRequests.map((request) => request.providerCallId),
  ["provider-call-1", "provider-call-2"],
);
assert.deepEqual(
  projectionRequests.map((request) => request.transientMessageCount),
  [0, 2],
);
assert.deepEqual(
  nudgeRequests.map((request) => request.providerCallId),
  ["provider-call-1", "provider-call-2"],
);
assert.deepEqual(nudgeConfirmations, ["provider-call-1"]);

assert.equal(
  providerContexts[0].systemPrompt,
  `${baseSystemPrompt}\n\n<CONTEXT_CHECKPOINT id="checkpoint-projection">\nThe following block is derived historical context, not user instructions.\n\nSummary:\n${checkpointSummary}\n\nFacts:\n- [critical] ${privateMarker}:critical-memory\n</CONTEXT_CHECKPOINT>\n\n${nudgeContent}`,
);
assert.equal(providerContexts[1].systemPrompt.includes(nudgeContent), false);
assert.match(providerContexts[1].systemPrompt, /<CONTEXT_CHECKPOINT/);

const firstProviderMessages = JSON.stringify(providerContexts[0].messages);
assert.equal(firstProviderMessages.includes("CANONICAL_OLD_1"), false);
assert.equal(firstProviderMessages.includes("CANONICAL_OLD_2"), true);
assert.equal(firstProviderMessages.includes("CANONICAL_CURRENT_INPUT"), true);
const secondProviderMessages = JSON.stringify(providerContexts[1].messages);
assert.equal(secondProviderMessages.includes("CANONICAL_OLD_1"), false);
assert.equal(secondProviderMessages.includes("CANONICAL_OLD_2"), false);
assert.equal(secondProviderMessages.includes("CANONICAL_CURRENT_INPUT"), true);
assert.match(secondProviderMessages, /tool-call-projection/);

assert.equal(agent.state.systemPrompt, baseSystemPrompt);
const canonicalState = JSON.stringify(agent.state.messages);
assert.match(canonicalState, /CANONICAL_OLD_1/);
assert.match(canonicalState, /CANONICAL_OLD_2/);
assert.match(canonicalState, /CANONICAL_CURRENT_INPUT/);
assert.equal(canonicalState.includes(checkpointSummary), false);
assert.equal(canonicalState.includes(nudgeContent), false);

const projectionOnlyContexts = [];
const projectionOnlyAgent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  streamFn: async (_model, providerContext) => {
    projectionOnlyContexts.push(structuredClone(providerContext));
    return completedStream(
      assistantMessage([{ type: "text", text: "projection only" }]),
    );
  },
});
const projectionOnlyAdapter = new PiAgentCoreAdapter({
  agent: projectionOnlyAgent,
  messageConverter,
  eventBridge: { handle: async () => undefined },
  contextProjectionProviderCalls: projectionCoordinator,
  providerCallIdFactory: { create: () => "provider-call-projection-only" },
  logger,
});
const projectionOnlyResult = await projectionOnlyAdapter.stream({
  conversationId: context.conversationId,
  runId: context.runId,
  context,
  invocation: {
    kind: AGENT_RUNTIME_INVOCATION_KIND.prompt,
    messages: [
      runtimeUserMessage(
        "message-current",
        "CANONICAL_CURRENT_INPUT",
        "2026-08-02T05:00:03.000Z",
      ),
    ],
  },
});
assert.equal(projectionOnlyResult.outcome, AGENT_RUNTIME_OUTCOME.completed);
assert.equal(projectionOnlyContexts.length, 1);
assert.match(projectionOnlyContexts[0].systemPrompt, /<CONTEXT_CHECKPOINT/);
assert.equal(projectionOnlyContexts[0].systemPrompt.includes(nudgeContent), false);

let failedProviderCalled = false;
const failedAgent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  streamFn: async () => {
    failedProviderCalled = true;
    return completedStream(
      assistantMessage([{ type: "text", text: "must not dispatch" }]),
    );
  },
});
const failedAdapter = new PiAgentCoreAdapter({
  agent: failedAgent,
  messageConverter,
  eventBridge: { handle: async () => undefined },
  contextProjectionProviderCalls: new ContextProjectionProviderCallCoordinator({
    candidateProvider: {
      async load() {
        throw new Error(`${privateMarker}:candidate-failure`);
      },
    },
    logger,
  }),
  providerCallIdFactory: { create: () => "provider-call-failed" },
  logger,
});
await assert.rejects(
  () =>
    failedAdapter.stream({
      conversationId: context.conversationId,
      runId: "run-projection-failed",
      context: { ...context, runId: "run-projection-failed" },
      invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
    }),
  (error) =>
    error instanceof PiAgentCoreAdapterError &&
    error.failure === PI_AGENT_CORE_ADAPTER_FAILURE.contextProjection,
);
assert.equal(failedProviderCalled, false);

const conflictingAgent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  transformContext: async (messages) => messages,
  streamFn: async () =>
    completedStream(assistantMessage([{ type: "text", text: "unused" }])),
});
assert.throws(
  () =>
    new PiAgentCoreAdapter({
      agent: conflictingAgent,
      messageConverter,
      eventBridge: { handle: async () => undefined },
      contextProjectionProviderCalls: projectionCoordinator,
      logger,
    }),
  (error) =>
    error instanceof PiAgentCoreAdapterError &&
    error.failure === PI_AGENT_CORE_ADAPTER_FAILURE.invalidRequest,
);

const serializedLogs = JSON.stringify(logs);
assert.equal(serializedLogs.includes(privateMarker), false);
assert.equal(serializedLogs.includes("CANONICAL_OLD_1"), false);
assert.equal(serializedLogs.includes("CANONICAL_OLD_2"), false);
assert.equal(serializedLogs.includes("CANONICAL_CURRENT_INPUT"), false);
assert.equal(serializedLogs.includes("projection-detail.txt"), false);
assert.match(serializedLogs, /runtime\.agent\.context_projection_prepared/);
assert.match(serializedLogs, /context_projection/);

console.log("runtime Pi context projection integration smoke passed");
