import assert from "node:assert/strict";
import {
  CONTEXT_BUDGET_DEFAULTS,
  CONTEXT_COMPACTION_EFFECT_TRIGGER,
  CONTEXT_PRESSURE_LEVEL,
  ContextPressurePolicy,
  RUNTIME_EFFECT_COORDINATOR_FAILURE,
  RUNTIME_POLICY_ENGINE_FAILURE,
  RUNTIME_POLICY_PHASE,
  RuntimeEffectCoordinator,
  RuntimeEffectCoordinatorError,
  RuntimePolicyEngine,
  RuntimePolicyEngineError,
  calculateContextPolicyTokenBoundaries,
  createSystemReminderAttachEffect,
} from "../dist/index.js";

const privateMarker = "PRIVATE_CONTEXT_CONTENT_MUST_NOT_APPEAR";
const logs = [];
const logger = {
  debug: (event, fields) => logs.push({ level: "debug", event, fields }),
  info: (event, fields) => logs.push({ level: "info", event, fields }),
  warn: (event, fields) => logs.push({ level: "warn", event, fields }),
  error: (event, fields) => logs.push({ level: "error", event, fields }),
  child: () => logger,
};

function pressure({
  totalTokens,
  floorTokens = 30_000,
  providerCallId = "provider-call-1",
  evaluatedAt = "2026-08-02T02:00:00.000Z",
}) {
  const baseSystemPromptTokens = 10_000;
  const toolSchemaTokens = 10_000;
  const pinnedMessageTokens = 5_000;
  const currentInputTokens = 5_000;
  const transientMessageTokens = floorTokens - 30_000;
  const recentMessageTokens = totalTokens - floorTokens;
  const thresholds = { ...CONTEXT_BUDGET_DEFAULTS };
  const usageRatio = totalTokens / 100_000;
  const level =
    usageRatio >= thresholds.hardAdmissionRatio
      ? CONTEXT_PRESSURE_LEVEL.hard
      : usageRatio >= thresholds.compactionRequestRatio
        ? CONTEXT_PRESSURE_LEVEL.compaction
        : usageRatio >= thresholds.softReminderRatio
          ? CONTEXT_PRESSURE_LEVEL.soft
          : CONTEXT_PRESSURE_LEVEL.normal;
  return {
    conversationId: "conversation-1",
    runId: "run-1",
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
      baseSystemPromptTokens,
      toolSchemaTokens,
      checkpointOverlayTokens: 0,
      nudgeReserveTokens: 0,
      pinnedMessageTokens,
      currentInputTokens,
      recentMessageTokens,
      transientMessageTokens,
      totalInputTokens: totalTokens,
    },
    irreducibleFloor: {
      baseSystemPromptTokens,
      toolSchemaTokens,
      pinnedMessageTokens,
      currentInputTokens,
      transientMessageTokens,
      totalTokens: floorTokens,
    },
    usageRatio,
    level,
  };
}

function context(snapshot) {
  return {
    phase: RUNTIME_POLICY_PHASE.beforeProviderCall,
    conversationId: snapshot.conversationId,
    runId: snapshot.runId,
    providerCallId: snapshot.providerCallId,
    evaluatedAt: snapshot.evaluatedAt,
    contextPressure: snapshot,
  };
}

function state(overrides = {}) {
  return {
    conversationId: "conversation-1",
    ...overrides,
  };
}

function attach(
  policyId,
  providerCallId = "provider-call-1",
  overrides = {},
) {
  return createSystemReminderAttachEffect({
    policyId,
    conversationId: "conversation-1",
    runId: "run-1",
    reminderId: `novel.reminder.${policyId}`,
    reminderKind: "todo_idle",
    templateId: `template.reminder.${policyId}`,
    templateVersion: "1",
    parameters: Object.freeze({ marker: privateMarker }),
    ...overrides,
  });
}

const policy = new ContextPressurePolicy();
const engine = new RuntimePolicyEngine({ policies: [policy], logger });

assert.deepEqual(engine.evaluate(context(pressure({ totalTokens: 60_000 })), state()), []);
assert.deepEqual(engine.evaluate(context(pressure({ totalTokens: 75_000 })), state()), []);

const compactionContext = context(pressure({ totalTokens: 85_000 }));
const compactionEffects = engine.evaluate(compactionContext, state());
assert.equal(compactionEffects.length, 1);
assert.equal(compactionEffects[0].kind, "context_compaction");
assert.equal(
  compactionEffects[0].trigger,
  CONTEXT_COMPACTION_EFFECT_TRIGGER.requestThreshold,
);
assert.deepEqual(calculateContextPolicyTokenBoundaries(compactionEffects[0].pressure), {
  targetTokens: 55_000,
  compactionRequestTokens: 82_000,
  hardAdmissionTokens: 92_000,
  minimumSavingsTokens: 5_000,
  automaticHysteresisTokens: 10_000,
});
assert.equal(Object.isFrozen(compactionEffects), true);
assert.equal(Object.isFrozen(compactionEffects[0]), true);
assert.equal(Object.isFrozen(compactionEffects[0].pressure), true);

const suppressed = engine.evaluate(
  compactionContext,
  state({
    contextCompaction: {
      lastAutomaticCompactionAt: "2026-08-02T01:00:00.000Z",
      newContentSinceLastAutomaticCompactionTokens: 9_999,
    },
  }),
);
assert.deepEqual(suppressed, []);

const hardEffects = engine.evaluate(
  context(pressure({ totalTokens: 95_000 })),
  state({
    contextCompaction: {
      lastAutomaticCompactionAt: "2026-08-02T01:00:00.000Z",
      newContentSinceLastAutomaticCompactionTokens: 0,
    },
  }),
);
assert.equal(hardEffects.length, 1);
assert.equal(
  hardEffects[0].trigger,
  CONTEXT_COMPACTION_EFFECT_TRIGGER.hardAdmissionRisk,
);

const irreducible = engine.evaluate(
  context(pressure({ totalTokens: 95_000, floorTokens: 92_000 })),
  state(),
);
assert.deepEqual(irreducible, []);

const firstPolicy = {
  id: "first_policy",
  phases: [RUNTIME_POLICY_PHASE.beforeProviderCall],
  evaluate: () => [attach("first_policy")],
};
const secondPolicy = {
  id: "second_policy",
  phases: [RUNTIME_POLICY_PHASE.beforeProviderCall],
  evaluate: () => [attach("second_policy")],
};
const orderedEngine = new RuntimePolicyEngine({
  policies: [firstPolicy, secondPolicy],
  logger,
});
firstPolicy.id = "mutated_policy";
firstPolicy.phases.length = 0;
assert.deepEqual(
  orderedEngine
    .evaluate(context(pressure({ totalTokens: 60_000 })), state())
    .map((effect) => effect.policyId),
  ["first_policy", "second_policy"],
);

assert.throws(
  () => orderedEngine.register({ ...firstPolicy, id: "second_policy", phases: [RUNTIME_POLICY_PHASE.beforeProviderCall] }),
  (error) =>
    error instanceof RuntimePolicyEngineError &&
    error.failure === RUNTIME_POLICY_ENGINE_FAILURE.duplicatePolicy,
);

const badEngine = new RuntimePolicyEngine({
  policies: [
    {
      id: "bad_policy",
      phases: [RUNTIME_POLICY_PHASE.beforeProviderCall],
      evaluate: () => [
        attach("bad_policy", "provider-call-1", {
          runId: `${privateMarker}:wrong-run`,
        }),
      ],
    },
  ],
  logger,
});
assert.throws(
  () => badEngine.evaluate(context(pressure({ totalTokens: 60_000 })), state()),
  (error) =>
    error instanceof RuntimePolicyEngineError &&
    error.failure === RUNTIME_POLICY_ENGINE_FAILURE.invalidEffect &&
    error.message.includes(privateMarker) === false,
);

const routeOrder = [];
const coordinator = new RuntimeEffectCoordinator({
  conversationId: "conversation-1",
  systemReminderAttachHandler: {
    async handle(runtimeContext, effect) {
      routeOrder.push(`start:reminder:${runtimeContext.providerCallId}:${effect.policyId}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      routeOrder.push(`end:reminder:${runtimeContext.providerCallId}:${effect.policyId}`);
      return {
        reminderId: effect.reminderId,
        kind: effect.reminderKind,
        content: "rendered",
        order: effect.order,
      };
    },
  },
  contextCompactionHandler: {
    async handle(runtimeContext, effect) {
      routeOrder.push(`start:compact:${runtimeContext.providerCallId}:${effect.policyId}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      routeOrder.push(`end:compact:${runtimeContext.providerCallId}:${effect.policyId}`);
    },
  },
  logger,
});

const firstContext = context(pressure({ totalTokens: 85_000 }));
const firstEffects = [attach("first_policy"), ...engine.evaluate(firstContext, state())];
const secondContext = context(
  pressure({
    totalTokens: 85_000,
    providerCallId: "provider-call-2",
    evaluatedAt: "2026-08-02T02:00:01.000Z",
  }),
);
const secondEffects = engine.evaluate(secondContext, state());
const [firstReceipt, secondReceipt] = await Promise.all([
  coordinator.execute({ context: firstContext, effects: firstEffects }),
  coordinator.execute({ context: secondContext, effects: secondEffects }),
]);
assert.equal(firstReceipt.effectCount, 2);
assert.equal(secondReceipt.effectCount, 1);
assert.equal(firstReceipt.attachedReminders.length, 1);
assert.equal(firstReceipt.attachedReminders[0].reminderId, "novel.reminder.first_policy");
assert.equal(Object.isFrozen(firstReceipt.attachedReminders), true);
assert.deepEqual(routeOrder, [
  "start:reminder:provider-call-1:first_policy",
  "end:reminder:provider-call-1:first_policy",
  "start:compact:provider-call-1:context_pressure",
  "end:compact:provider-call-1:context_pressure",
  "start:compact:provider-call-2:context_pressure",
  "end:compact:provider-call-2:context_pressure",
]);

let compactionAttempts = 0;
const recoveringCoordinator = new RuntimeEffectCoordinator({
  conversationId: "conversation-1",
  contextCompactionHandler: {
    async handle() {
      compactionAttempts += 1;
      if (compactionAttempts === 1) throw new Error(privateMarker);
    },
  },
  logger,
});
await assert.rejects(
  recoveringCoordinator.execute({ context: firstContext, effects: compactionEffects }),
  (error) =>
    error instanceof RuntimeEffectCoordinatorError &&
    error.failure === RUNTIME_EFFECT_COORDINATOR_FAILURE.compactionFailed &&
    error.message.includes(privateMarker) === false,
);
const recoveredReceipt = await recoveringCoordinator.execute({
  context: firstContext,
  effects: compactionEffects,
});
assert.equal(recoveredReceipt.effectCount, 1);
assert.equal(compactionAttempts, 2);
await recoveringCoordinator.drain();

const serializedLogs = JSON.stringify(logs);
assert.equal(serializedLogs.includes(privateMarker), false);
assert.equal(serializedLogs.includes("stack"), false);
assert.equal(serializedLogs.includes("cause"), false);

console.log("runtime policy effect coordination smoke passed");
