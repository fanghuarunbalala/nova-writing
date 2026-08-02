import assert from "node:assert/strict";
import { Agent } from "@earendil-works/pi-agent-core";
import {
  AGENT_RUNTIME_INVOCATION_KIND,
  AGENT_RUNTIME_OUTCOME,
  BaseContextCompiler,
  InMemoryPendingNudgeStore,
  NudgeManager,
  NudgeProviderCallCoordinator,
  NudgeRenderer,
  NudgeSelector,
  NudgeTemplateRegistry,
  PENDING_NUDGE_STATE,
} from "../dist/index.js";
import {
  PI_AGENT_CORE_ADAPTER_FAILURE,
  PiAgentCoreAdapter,
  PiAgentCoreAdapterError,
} from "../dist/runtime/agent/pi/index.js";

const sensitiveParameter = "SENSITIVE_NUDGE_PARAMETER";
const sensitiveReminder = "SENSITIVE_ONE_SHOT_REMINDER";
const sensitiveEventFailure = "SENSITIVE_EVENT_APPEND_FAILURE";
const baseSystemPrompt = "BASE_SYSTEM_PROMPT";

const logs = [];
const logger = {
  debug: (event, fields) => logs.push({ level: "debug", event, fields }),
  info: (event, fields) => logs.push({ level: "info", event, fields }),
  warn: (event, fields) => logs.push({ level: "warn", event, fields }),
  error: (event, fields) => logs.push({ level: "error", event, fields }),
  child: () => logger,
};

const model = {
  id: "nudge-smoke-model",
  name: "Nudge Smoke Model",
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

function assistantMessage(content, stopReason = "stop", errorMessage) {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage,
    stopReason,
    ...(errorMessage === undefined ? {} : { errorMessage }),
    timestamp: Date.parse("2026-08-02T00:00:01.000Z"),
  };
}

function completedStream(finalMessage) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: finalMessage };
      if (finalMessage.stopReason === "error") {
        yield { type: "error", reason: "error", error: finalMessage };
      } else {
        yield {
          type: "done",
          reason: finalMessage.stopReason,
          message: finalMessage,
        };
      }
    },
    result: async () => finalMessage,
  };
}

function userMessage(id, conversationId) {
  return {
    id,
    conversationId,
    role: "user",
    messageType: "user.message",
    schemaVersion: 1,
    timestamp: "2026-08-02T00:00:00.000Z",
    payload: { content: [{ type: "text", text: "write the next scene" }] },
  };
}

const messageConverter = {
  convert: async ({ messages }) =>
    messages.map((message) => ({
      role: "user",
      content: message.payload.content.map((item) => ({ ...item })),
      timestamp: Date.parse(message.timestamp),
    })),
};

function createNudgeRuntime(options = {}) {
  const templates = new NudgeTemplateRegistry({ logger });
  templates.register({
    templateId: "runtime.one-shot",
    templateVersion: "1",
    render: (parameters) => `${sensitiveReminder}:${parameters.privateValue}`,
  });
  const store = new InMemoryPendingNudgeStore({ logger });
  const manager = new NudgeManager({
    store,
    selector: new NudgeSelector({ logger }),
    renderer: new NudgeRenderer({ templates, logger }),
    leaseIdFactory: {
      create: (request) => `lease:${request.providerCallId}`,
    },
    logger,
  });
  const privateSnapshots = [];
  const publicEvents = [];
  const coordinator = new NudgeProviderCallCoordinator({
    manager,
    privateStateCommitter: {
      commit: async (snapshot) => privateSnapshots.push(snapshot),
    },
    eventSink: {
      append: async (event) => {
        if (options.failEventAppend === true) {
          throw new Error(sensitiveEventFailure);
        }
        const snapshot = event.getSnapshot();
        publicEvents.push(snapshot);
        return {
          status: "recorded",
          conversationId: snapshot.conversationId,
          eventId: snapshot.id,
          sequence: publicEvents.length,
          recordedAt: snapshot.timestamp,
        };
      },
    },
    eventIdFactory: {
      create: (input) =>
        `event:${input.providerCallId}:${input.nudgeId}:${input.eventType}`,
    },
    logger,
  });
  return { store, manager, coordinator, privateSnapshots, publicEvents };
}

async function scheduleOne(manager, nudgeId, runId, sequence) {
  await manager.schedule({
    nudgeId,
    effect: {
      kind: "nudge",
      policyId: "policy.one-shot",
      templateId: "runtime.one-shot",
      templateVersion: "1",
      priority: 100,
      dedupeKey: "one-shot",
      targetRunId: runId,
      parameters: { privateValue: sensitiveParameter },
    },
    scheduledSequence: sequence,
    scheduledAt: "2026-08-02T00:00:00.000Z",
  });
}

const compiler = new BaseContextCompiler();
const runtime = createNudgeRuntime();
await scheduleOne(runtime.manager, "nudge-overlay-1", "run-overlay", 10);
const providerPrompts = [];
let providerCallCount = 0;
const overlayAgent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  streamFn: async () => {
    throw new Error("adapter must replace the plain StreamFn");
  },
});
const overlayAdapter = new PiAgentCoreAdapter({
  agent: overlayAgent,
  messageConverter,
  eventBridge: { handle: async () => undefined },
  nudgeProviderCalls: runtime.coordinator,
  dispatchAwareStreamFunction: async (_model, context, _options, hooks) => {
    providerCallCount += 1;
    providerPrompts.push(context.systemPrompt);
    if (providerCallCount === 1) {
      await hooks.onDispatched("2026-08-02T00:00:02.000Z");
      await hooks.onDispatched("2026-08-02T00:00:02.000Z");
      return completedStream(
        assistantMessage(
          [
            {
              type: "toolCall",
              id: "tool-call-1",
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
  providerCallClock: {
    now: () => "2026-08-02T00:00:01.000Z",
  },
  logger,
});
const overlayContext = await compiler.compile({
  conversationId: "conversation-overlay",
  runId: "run-overlay",
  systemPrompt: baseSystemPrompt,
  messages: [userMessage("message-overlay", "conversation-overlay")],
});
const overlayResult = await overlayAdapter.stream({
  conversationId: overlayContext.conversationId,
  runId: overlayContext.runId,
  context: overlayContext,
  invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
});
assert.equal(overlayResult.outcome, AGENT_RUNTIME_OUTCOME.completed);
assert.equal(providerCallCount, 2);
assert.equal(
  providerPrompts[0],
  `${baseSystemPrompt}\n\n${sensitiveReminder}:${sensitiveParameter}`,
);
assert.equal(providerPrompts[1], baseSystemPrompt);
assert.equal(overlayAgent.state.systemPrompt, baseSystemPrompt);
assert.equal(overlayContext.systemPrompt, baseSystemPrompt);
assert.equal(
  JSON.stringify(overlayAgent.state.messages).includes(sensitiveReminder),
  false,
);
assert.equal(
  JSON.stringify(overlayAgent.state.messages).includes(sensitiveParameter),
  false,
);
assert.equal(runtime.publicEvents.length, 1);
assert.equal(runtime.publicEvents[0].eventType, "system.reminder.injected");
assert.equal(runtime.publicEvents[0].payload.providerCallId, "provider-call-1");
assert.equal(
  JSON.stringify(runtime.publicEvents).includes(sensitiveReminder),
  false,
);
assert.equal(
  JSON.stringify(runtime.publicEvents).includes(sensitiveParameter),
  false,
);
assert.equal(
  (await runtime.store.list())[0].state,
  PENDING_NUDGE_STATE.consumed,
);
assert.equal(
  runtime.privateSnapshots.some((snapshot) => snapshot.leases.length === 1),
  true,
);
assert.equal(
  runtime.privateSnapshots.some(
    (snapshot) =>
      snapshot.nudges[0].state === PENDING_NUDGE_STATE.consumed &&
      snapshot.leases.length === 0,
  ),
  true,
);

const preDispatch = createNudgeRuntime();
await scheduleOne(
  preDispatch.manager,
  "nudge-before-dispatch",
  "run-before-dispatch",
  20,
);
const preDispatchAgent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  streamFn: async () => {
    throw new Error("adapter must replace the plain StreamFn");
  },
});
const preDispatchAdapter = new PiAgentCoreAdapter({
  agent: preDispatchAgent,
  messageConverter,
  eventBridge: { handle: async () => undefined },
  nudgeProviderCalls: preDispatch.coordinator,
  dispatchAwareStreamFunction: async (_model, _context, _options, hooks) => {
    await hooks.onFailedBeforeDispatch("2026-08-02T00:10:02.000Z");
    return completedStream(
      assistantMessage(
        [{ type: "text", text: "local failure" }],
        "error",
        "LOCAL_PRE_DISPATCH_FAILURE",
      ),
    );
  },
  providerCallIdFactory: { create: () => "provider-call-before-dispatch" },
  providerCallClock: { now: () => "2026-08-02T00:10:01.000Z" },
  logger,
});
const preDispatchContext = await compiler.compile({
  conversationId: "conversation-before-dispatch",
  runId: "run-before-dispatch",
  systemPrompt: baseSystemPrompt,
  messages: [
    userMessage("message-before-dispatch", "conversation-before-dispatch"),
  ],
});
const preDispatchResult = await preDispatchAdapter.stream({
  conversationId: preDispatchContext.conversationId,
  runId: preDispatchContext.runId,
  context: preDispatchContext,
  invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
});
assert.equal(preDispatchResult.outcome, AGENT_RUNTIME_OUTCOME.failed);
assert.equal(preDispatch.publicEvents.length, 0);
assert.equal(
  (await preDispatch.store.list())[0].state,
  PENDING_NUDGE_STATE.scheduled,
);

const missingHook = createNudgeRuntime();
await scheduleOne(missingHook.manager, "nudge-missing-hook", "run-missing-hook", 30);
const missingHookAgent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  streamFn: async () => {
    throw new Error("adapter must replace the plain StreamFn");
  },
});
const missingHookAdapter = new PiAgentCoreAdapter({
  agent: missingHookAgent,
  messageConverter,
  eventBridge: { handle: async () => undefined },
  nudgeProviderCalls: missingHook.coordinator,
  dispatchAwareStreamFunction: async () =>
    completedStream(assistantMessage([{ type: "text", text: "unsafe" }])),
  providerCallIdFactory: { create: () => "provider-call-missing-hook" },
  providerCallClock: { now: () => "2026-08-02T00:20:01.000Z" },
  logger,
});
const missingHookContext = await compiler.compile({
  conversationId: "conversation-missing-hook",
  runId: "run-missing-hook",
  systemPrompt: baseSystemPrompt,
  messages: [userMessage("message-missing-hook", "conversation-missing-hook")],
});
await assert.rejects(
  () =>
    missingHookAdapter.stream({
      conversationId: missingHookContext.conversationId,
      runId: missingHookContext.runId,
      context: missingHookContext,
      invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
    }),
  (error) =>
    error instanceof PiAgentCoreAdapterError &&
    error.failure === PI_AGENT_CORE_ADAPTER_FAILURE.providerDispatchProtocol,
);
assert.equal(missingHook.publicEvents.length, 0);
assert.equal(
  (await missingHook.store.list())[0].state,
  PENDING_NUDGE_STATE.scheduled,
);

const eventFailure = createNudgeRuntime({ failEventAppend: true });
await scheduleOne(eventFailure.manager, "nudge-event-failure", "run-event-failure", 40);
const eventFailureAgent = new Agent({
  initialState: { model, systemPrompt: "", messages: [], tools: [] },
  streamFn: async () => {
    throw new Error("adapter must replace the plain StreamFn");
  },
});
const eventFailureAdapter = new PiAgentCoreAdapter({
  agent: eventFailureAgent,
  messageConverter,
  eventBridge: { handle: async () => undefined },
  nudgeProviderCalls: eventFailure.coordinator,
  dispatchAwareStreamFunction: async (_model, _context, _options, hooks) => {
    await hooks.onDispatched("2026-08-02T00:30:02.000Z");
    return completedStream(assistantMessage([{ type: "text", text: "unused" }]));
  },
  providerCallIdFactory: { create: () => "provider-call-event-failure" },
  providerCallClock: { now: () => "2026-08-02T00:30:01.000Z" },
  logger,
});
const eventFailureContext = await compiler.compile({
  conversationId: "conversation-event-failure",
  runId: "run-event-failure",
  systemPrompt: baseSystemPrompt,
  messages: [userMessage("message-event-failure", "conversation-event-failure")],
});
await assert.rejects(
  () =>
    eventFailureAdapter.stream({
      conversationId: eventFailureContext.conversationId,
      runId: eventFailureContext.runId,
      context: eventFailureContext,
      invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
    }),
  (error) =>
    error instanceof PiAgentCoreAdapterError &&
    error.failure === PI_AGENT_CORE_ADAPTER_FAILURE.providerDispatchProtocol,
);
assert.equal(eventFailure.publicEvents.length, 0);
assert.equal(
  (await eventFailure.store.list())[0].state,
  PENDING_NUDGE_STATE.consumed,
);

const serializedLogs = JSON.stringify(logs);
assert.equal(serializedLogs.includes(sensitiveReminder), false);
assert.equal(serializedLogs.includes(sensitiveParameter), false);
assert.equal(serializedLogs.includes("LOCAL_PRE_DISPATCH_FAILURE"), false);
assert.equal(serializedLogs.includes(sensitiveEventFailure), false);
