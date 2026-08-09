import assert from "node:assert/strict";
import {
  CONTEXT_BUDGET_DEFAULTS,
  CONTEXT_PRESSURE_LEVEL,
  NudgeTemplateRegistry,
  RUNTIME_EFFECT_COORDINATOR_FAILURE,
  RuntimeEffectCoordinator,
  RuntimeEffectCoordinatorError,
  RuntimeSystemReminderAttachPolicyEffectHandler,
  RUNTIME_POLICY_PHASE,
  SystemReminderAttachedOutputEvent,
  createSystemReminderAttachEffect,
} from "../dist/index.js";

const events = [];
const eventSink = {
  async append(event) {
    events.push(event);
    return {
      status: "recorded",
      conversationId: event.conversationId,
      eventId: event.id,
      sequence: events.length,
      recordedAt: "2026-08-03T00:00:01.000Z",
    };
  },
};

function policyContext(providerCallId = "provider-policy") {
  const evaluatedAt = "2026-08-03T00:00:00.000Z";
  const thresholds = { ...CONTEXT_BUDGET_DEFAULTS };
  const pressure = {
    conversationId: "conversation-policy",
    runId: "run-policy",
    providerCallId,
    evaluatedAt,
    budget: {
      providerContextWindowTokens: 120_000,
      reservedOutputTokens: 10_000,
      protocolOverheadTokens: 5_000,
      safetyReserveTokens: 5_000,
      effectiveInputTokens: 100_000,
      thresholds,
    },
    estimate: {
      baseSystemPromptTokens: 10_000,
      toolSchemaTokens: 10_000,
      checkpointOverlayTokens: 0,
      nudgeReserveTokens: 0,
      pinnedMessageTokens: 5_000,
      currentInputTokens: 5_000,
      recentMessageTokens: 5_000,
      transientMessageTokens: 0,
      totalInputTokens: 35_000,
    },
    irreducibleFloor: {
      baseSystemPromptTokens: 10_000,
      toolSchemaTokens: 10_000,
      pinnedMessageTokens: 5_000,
      currentInputTokens: 5_000,
      transientMessageTokens: 0,
      totalTokens: 30_000,
    },
    usageRatio: 0.35,
    level: CONTEXT_PRESSURE_LEVEL.normal,
  };
  return {
    phase: RUNTIME_POLICY_PHASE.beforeProviderCall,
    conversationId: "conversation-policy",
    runId: "run-policy",
    providerCallId,
    evaluatedAt,
    contextPressure: pressure,
  };
}

function createRuntime(templates) {
  const handler = new RuntimeSystemReminderAttachPolicyEffectHandler({
    eventSink,
    templates,
  });
  const coordinator = new RuntimeEffectCoordinator({
    conversationId: "conversation-policy",
    systemReminderAttachHandler: handler,
  });
  return { coordinator, handler };
}

function attachEffect(
  reminderId,
  templateId = "policy.template",
  overrides = {},
) {
  return createSystemReminderAttachEffect({
    policyId: "policy.reminder",
    conversationId: "conversation-policy",
    runId: "run-policy",
    reminderId,
    reminderKind: "todo_idle",
    templateId,
    templateVersion: "1",
    parameters: Object.freeze({}),
    ...overrides,
  });
}

const templates = new NudgeTemplateRegistry();
templates.register({
  templateId: "policy.template",
  templateVersion: "1",
  render: (parameters) =>
    `private policy reminder ${parameters.label ?? ""}`.trim(),
});
const runtime = createRuntime(templates);
const firstContext = policyContext("provider-policy-1");
const secondContext = policyContext("provider-policy-2");
const [firstReceipt, secondReceipt] = await Promise.all([
  runtime.coordinator.execute({
    context: firstContext,
    effects: [attachEffect("novel.reminder.one", "policy.template", { parameters: Object.freeze({ label: "one" }) })],
  }),
  runtime.coordinator.execute({
    context: secondContext,
    effects: [attachEffect("novel.reminder.two", "policy.template", { parameters: Object.freeze({ label: "two" }) })],
  }),
]);
assert.equal(firstReceipt.effectCount, 1);
assert.equal(secondReceipt.effectCount, 1);
assert.equal(firstReceipt.attachedReminders.length, 1);
assert.equal(firstReceipt.attachedReminders[0].reminderId, "novel.reminder.one");
assert.equal(firstReceipt.attachedReminders[0].content, "private policy reminder one");
assert.equal(Object.isFrozen(firstReceipt.attachedReminders), true);
assert.deepEqual(
  events.map((event) => event.getEventType()),
  ["system.reminder.attached", "system.reminder.attached"],
);
assert.deepEqual(
  events.map((event) => event.payload.kind),
  ["todo_idle", "todo_idle"],
);
assert.ok(events[0] instanceof SystemReminderAttachedOutputEvent);
assert.equal(events[0].payload.content, "private policy reminder one");
assert.equal(events[0].payload.order, firstReceipt.attachedReminders[0].order);

// 模板未注册 → 渲染失败 → systemReminderAttachFailed（不含原始错误）。
const missingTemplateRuntime = createRuntime(new NudgeTemplateRegistry());
await assert.rejects(
  missingTemplateRuntime.coordinator.execute({
    context: firstContext,
    effects: [attachEffect("novel.reminder.missing")],
  }),
  (error) =>
    error instanceof RuntimeEffectCoordinatorError &&
    error.failure === RUNTIME_EFFECT_COORDINATOR_FAILURE.systemReminderAttachFailed,
);

// handler 缺失 → systemReminderAttachHandlerMissing。
const missingHandler = new RuntimeEffectCoordinator({
  conversationId: "conversation-policy",
});
await assert.rejects(
  () =>
    missingHandler.execute({
      context: firstContext,
      effects: [attachEffect("novel.reminder.nohandler")],
    }),
  (error) =>
    error instanceof RuntimeEffectCoordinatorError &&
    error.failure ===
      RUNTIME_EFFECT_COORDINATOR_FAILURE.systemReminderAttachHandlerMissing,
);

console.log("runtime policy nudge effect execution smoke: passed");
