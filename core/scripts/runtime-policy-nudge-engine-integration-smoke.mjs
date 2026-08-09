import assert from "node:assert/strict";
import {
  CONTEXT_BUDGET_DEFAULTS,
  CONTEXT_PRESSURE_LEVEL,
  RUNTIME_POLICY_ENGINE_FAILURE,
  RUNTIME_POLICY_PHASE,
  RuntimePolicyEngine,
  RuntimePolicyEngineError,
  createSystemReminderAttachEffect,
} from "../dist/index.js";

function context() {
  const evaluatedAt = "2026-08-03T00:00:00.000Z";
  const thresholds = { ...CONTEXT_BUDGET_DEFAULTS };
  const pressure = {
    conversationId: "conversation-engine",
    runId: "run-engine",
    providerCallId: "provider-engine",
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
    conversationId: pressure.conversationId,
    runId: pressure.runId,
    providerCallId: pressure.providerCallId,
    evaluatedAt,
    contextPressure: pressure,
  };
}

const policy = {
  id: "policy.reminder",
  phases: [RUNTIME_POLICY_PHASE.beforeProviderCall],
  evaluate: () => [
    createSystemReminderAttachEffect({
      policyId: "policy.reminder",
      conversationId: "conversation-engine",
      runId: "run-engine",
      reminderId: "novel.reminder.todo_idle",
      reminderKind: "todo_idle",
      templateId: "novel.reminder.todo_idle",
      templateVersion: "1.0.0",
      parameters: Object.freeze({}),
    }),
    createSystemReminderAttachEffect({
      policyId: "policy.reminder",
      conversationId: "conversation-engine",
      runId: "run-engine",
      reminderId: "novel.reminder.compose_mode_exit",
      reminderKind: "compose_mode_exit",
      templateId: "novel.reminder.compose_mode_exit",
      templateVersion: "1.0.0",
      parameters: Object.freeze({}),
    }),
  ],
};
const engine = new RuntimePolicyEngine({ policies: [policy] });
const effects = engine.evaluate(context(), { conversationId: "conversation-engine" });
assert.deepEqual(
  effects.map((effect) => effect.kind),
  ["system_reminder_attach", "system_reminder_attach"],
);
assert.deepEqual(
  effects.map((effect) => effect.reminderKind),
  ["todo_idle", "compose_mode_exit"],
);
assert.equal(effects.every((effect) => Object.isFrozen(effect)), true);
// order 单调递增，供同调用内稳定排序。
assert.equal(effects[0].order < effects[1].order, true);

const invalidPolicy = new RuntimePolicyEngine({
  policies: [{
    id: "policy.invalid",
    phases: [RUNTIME_POLICY_PHASE.beforeProviderCall],
    evaluate: () => [
      createSystemReminderAttachEffect({
        policyId: "policy.invalid",
        conversationId: "conversation-engine",
        runId: "other-run",
        reminderId: "novel.reminder.todo_idle",
        reminderKind: "todo_idle",
        templateId: "novel.reminder.todo_idle",
        templateVersion: "1.0.0",
        parameters: Object.freeze({}),
      }),
    ],
  }],
});
assert.throws(
  () => invalidPolicy.evaluate(context(), { conversationId: "conversation-engine" }),
  (error) =>
    error instanceof RuntimePolicyEngineError &&
    error.failure === RUNTIME_POLICY_ENGINE_FAILURE.invalidEffect,
);

console.log("runtime policy nudge engine integration smoke: passed");
