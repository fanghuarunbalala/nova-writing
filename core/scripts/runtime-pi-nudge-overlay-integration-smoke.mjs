import assert from "node:assert/strict";
import { Agent } from "@earendil-works/pi-agent-core";
import {
  AGENT_RUNTIME_INVOCATION_KIND,
  AGENT_RUNTIME_OUTCOME,
  BaseContextCompiler,
  NudgeTemplateRegistry,
  RUNTIME_POLICY_PHASE,
  RuntimeEffectCoordinator,
  RuntimePolicyEngine,
  RuntimeSystemReminderAttachPolicyEffectHandler,
  SystemReminderAttachedOutputEvent,
  createSystemReminderAttachEffect,
} from "../dist/index.js";
import {
  PiAgentCoreAdapter,
} from "../dist/runtime/agent/pi/index.js";

const sensitiveParameter = "SENSITIVE_NUDGE_PARAMETER";
const sensitiveReminder = "SENSITIVE_ONE_SHOT_REMINDER";
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

function assistantMessage(content, stopReason = "stop") {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage,
    stopReason,
    timestamp: Date.parse("2026-08-02T00:00:01.000Z"),
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
    messages.map((message) => {
      if (message.messageType === "system.reminder") {
        return {
          role: "user",
          content: [{
            type: "text",
            text: `<system-reminder kind="${message.payload.kind}">\n${message.payload.content}\n</system-reminder>`,
          }],
          timestamp: Date.parse(message.timestamp),
        };
      }
      return {
        role: "user",
        content: message.payload.content.map((item) => ({ ...item })),
        timestamp: Date.parse(message.timestamp),
      };
    }),
};

/**
 * 持久化 + 同 run 注入装配（对齐 DesktopRuntimeChildCompositionFactory）：
 * policy 引擎 → effect coordinator → RuntimeSystemReminderAttachPolicyEffectHandler
 * 渲染并 append SystemReminderAttachedOutputEvent → 回执 attachedReminders 记入
 * adapter 的 runReminders → 每次 provider call 尾部作为瞬态 system.reminder 注入。
 */
function createOverlayRuntime(conversationId) {
  const templates = new NudgeTemplateRegistry({ logger });
  templates.register({
    templateId: "runtime.one-shot",
    templateVersion: "1",
    render: (parameters) => `${sensitiveReminder}:${parameters.privateValue}`,
  });
  const appendedEvents = [];
  const eventSink = {
    async append(event) {
      appendedEvents.push(event);
      return {
        status: "recorded",
        conversationId: event.conversationId,
        eventId: event.id,
        sequence: appendedEvents.length,
        recordedAt: "2026-08-02T00:00:02.000Z",
      };
    },
  };
  const handler = new RuntimeSystemReminderAttachPolicyEffectHandler({
    eventSink,
    templates,
    logger,
  });
  // 首次 provider call 附一条（全局 latch——真实装配中 compose/todo policy 实例
  // 在 child 进程内跨 run 复用同一实例，效果不重复 emit）。
  let attached = false;
  const overlayPolicy = {
    id: "policy.overlay",
    phases: [RUNTIME_POLICY_PHASE.beforeProviderCall],
    evaluate: (context) => {
      if (attached) return [];
      attached = true;
      return [
        createSystemReminderAttachEffect({
          policyId: "policy.overlay",
          conversationId: context.conversationId,
          runId: context.runId,
          reminderId: "novel.reminder.overlay",
          reminderKind: "todo_idle",
          templateId: "runtime.one-shot",
          templateVersion: "1",
          parameters: Object.freeze({ privateValue: sensitiveParameter }),
        }),
      ];
    },
  };
  const policyEngine = new RuntimePolicyEngine({ policies: [overlayPolicy], logger });
  const effectCoordinator = new RuntimeEffectCoordinator({
    conversationId,
    systemReminderAttachHandler: handler,
    logger,
  });
  return { appendedEvents, policyEngine, effectCoordinator };
}

/** 装配 adapter + 记录每次 provider call 的 systemPrompt 与消息数组。 */
function createAdapter(runtime) {
  const agent = new Agent({
    initialState: { model, systemPrompt: "", messages: [], tools: [] },
    streamFn: async () => {
      throw new Error("adapter must replace the plain StreamFn");
    },
  });
  const providerPrompts = [];
  const providerMessages = [];
  let providerCallCount = 0;
  const adapter = new PiAgentCoreAdapter({
    agent,
    messageConverter,
    eventBridge: { handle: async () => undefined },
    policyEngine: runtime.policyEngine,
    effectCoordinator: runtime.effectCoordinator,
    dispatchAwareStreamFunction: async (_model, context, _options) => {
      providerCallCount += 1;
      providerPrompts.push(context.systemPrompt);
      providerMessages.push(context.messages);
      if (providerCallCount === 1) {
        // call#1：返回 tool call → 驱动 agent 再来一次 provider call。
        return completedStream(
          assistantMessage(
            [
              {
                type: "toolCall",
                id: "tool-call-1",
                name: "MissingTool",
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
  return { adapter, agent, providerPrompts, providerMessages };
}

function findOverlay(messageArray) {
  return messageArray.find(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some(
        (item) =>
          item.text?.startsWith('<system-reminder kind="todo_idle">') &&
          item.text.includes(sensitiveReminder),
      ),
  );
}

// ---------------------------------------------------------------------------
// 场景 1：首次 provider call 触发 → 恰好一条持久化事件；触发当次及后续 call 尾部
// 都带瞬态 overlay；systemPrompt 恒为 base；state.messages 不含 reminder。
// ---------------------------------------------------------------------------
const runtime = createOverlayRuntime("conversation-overlay");
const { adapter, agent, providerPrompts, providerMessages } = createAdapter(runtime);
const compiler = new BaseContextCompiler();
const overlayContext = await compiler.compile({
  conversationId: "conversation-overlay",
  runId: "run-overlay",
  systemPrompt: baseSystemPrompt,
  messages: [userMessage("message-overlay", "conversation-overlay")],
});
const overlayResult = await adapter.stream({
  conversationId: overlayContext.conversationId,
  runId: overlayContext.runId,
  context: overlayContext,
  invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
});
assert.equal(overlayResult.outcome, AGENT_RUNTIME_OUTCOME.completed);
assert.equal(providerMessages.length, 2);

// systemPrompt 恒为 base；overlay 以瞬态 system.reminder 追加在消息数组尾部。
assert.equal(providerPrompts[0], baseSystemPrompt);
assert.equal(providerPrompts[1], baseSystemPrompt);
for (const [callIndex, messages] of providerMessages.entries()) {
  const overlayPiMessage = findOverlay(messages);
  assert.ok(
    overlayPiMessage,
    `provider call #${callIndex + 1} 尾部应带瞬态 overlay`,
  );
  assert.ok(
    overlayPiMessage.content.some((item) => item.text.includes(sensitiveParameter)),
  );
}
// 触发当次即带（call#1 = 触发 call），后续 call#2 回放。
assert.equal(JSON.stringify(providerMessages[0]).includes(sensitiveReminder), true);
assert.equal(JSON.stringify(providerMessages[1]).includes(sensitiveReminder), true);

// 持久化：恰好一条 SystemReminderAttachedOutputEvent，正文含敏感内容。
assert.equal(runtime.appendedEvents.length, 1);
const persistedEvent = runtime.appendedEvents[0];
assert.ok(persistedEvent instanceof SystemReminderAttachedOutputEvent);
assert.equal(persistedEvent.getEventType(), "system.reminder.attached");
assert.equal(persistedEvent.runId, "run-overlay");
assert.equal(persistedEvent.payload.kind, "todo_idle");
assert.equal(persistedEvent.payload.reminderId, "novel.reminder.overlay");
assert.equal(
  persistedEvent.payload.content,
  `${sensitiveReminder}:${sensitiveParameter}`,
);
assert.equal(persistedEvent.payload.order >= 1, true);

// reminder 不入 agent.state.messages（瞬态 overlay 只进本次 provider call）。
assert.equal(agent.state.systemPrompt, baseSystemPrompt);
assert.equal(overlayContext.systemPrompt, baseSystemPrompt);
assert.equal(
  JSON.stringify(agent.state.messages).includes(sensitiveReminder),
  false,
);
assert.equal(
  JSON.stringify(agent.state.messages).includes(sensitiveParameter),
  false,
);

// ---------------------------------------------------------------------------
// 场景 2：新 run → runReminders 随 run 起始清空（per-run 状态，不跨 run 泄漏）；
// policy latch 不重发 → 无新事件、无 overlay。
// ---------------------------------------------------------------------------
const secondContext = await compiler.compile({
  conversationId: "conversation-overlay",
  runId: "run-overlay-2",
  systemPrompt: baseSystemPrompt,
  messages: [userMessage("message-overlay-2", "conversation-overlay")],
});
const beforeSecondRunEvents = runtime.appendedEvents.length;
const secondResult = await adapter.stream({
  conversationId: secondContext.conversationId,
  runId: secondContext.runId,
  context: secondContext,
  invocation: { kind: AGENT_RUNTIME_INVOCATION_KIND.continue },
});
assert.equal(secondResult.outcome, AGENT_RUNTIME_OUTCOME.completed);
// 新 run 只有一个 provider call（dispatch 直接返回 final answer），其消息数组
// 不含 overlay（runReminders 未从上一 run 泄漏）。
const secondRunMessages = providerMessages.slice(2);
assert.ok(secondRunMessages.length >= 1);
for (const messages of secondRunMessages) {
  assert.equal(
    findOverlay(messages),
    undefined,
    "新 run 的 provider call 不应带上一 run 的 overlay",
  );
}
// policy latch 不重发 → 无新持久化事件。
assert.equal(runtime.appendedEvents.length, beforeSecondRunEvents);

// ---------------------------------------------------------------------------
// 脱敏：reminder 正文持久化进事件，但不得出现在日志里。
// ---------------------------------------------------------------------------
const serializedLogs = JSON.stringify(logs);
assert.equal(serializedLogs.includes(sensitiveReminder), false);
assert.equal(serializedLogs.includes(sensitiveParameter), false);

console.log("runtime pi nudge overlay integration smoke: passed");
