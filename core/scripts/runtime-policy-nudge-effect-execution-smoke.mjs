import assert from "node:assert/strict";
import {
  CONTEXT_BUDGET_DEFAULTS,
  CONTEXT_PRESSURE_LEVEL,
  InMemoryPendingNudgeStore,
  NudgeManager,
  NudgeRenderer,
  NudgeSelector,
  NudgeTemplateRegistry,
  PENDING_NUDGE_STATE,
  RUNTIME_EFFECT_COORDINATOR_FAILURE,
  RuntimeEffectCoordinator,
  RuntimeEffectCoordinatorError,
  RuntimeNudgePolicyEffectHandler,
  RUNTIME_POLICY_PHASE,
} from "../dist/index.js";

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

function createRuntime() {
  const templates = new NudgeTemplateRegistry();
  templates.register({
    templateId: "policy.template",
    templateVersion: "1",
    render: () => "private policy reminder",
  });
  const store = new InMemoryPendingNudgeStore();
  const manager = new NudgeManager({
    store,
    selector: new NudgeSelector(),
    renderer: new NudgeRenderer({ templates }),
    leaseIdFactory: {
      create: (request) => `lease:${request.providerCallId}`,
    },
  });
  const coordinator = new RuntimeEffectCoordinator({
    conversationId: "conversation-policy",
    nudgeLifecycleHandler: new RuntimeNudgePolicyEffectHandler(manager),
  });
  return { store, manager, coordinator };
}

function scheduleEffect(
  nudgeId,
  targetRunId = "run-policy",
  sequence = 1,
  delivery,
) {
  return {
    kind: "nudge_schedule",
    policyId: "policy.nudge",
    conversationId: "conversation-policy",
    runId: "run-policy",
    nudgeId,
    effect: {
      kind: "nudge",
      policyId: "policy.nudge",
      templateId: "policy.template",
      templateVersion: "1",
      ...(delivery === "until_acknowledged"
        ? {
            delivery,
            acknowledgementRef: { id: `ack.${nudgeId}`, version: "1" },
          }
        : delivery === "until_condition"
          ? {
              delivery,
              conditionRef: { id: `condition.${nudgeId}`, version: "1" },
            }
          : {}),
      priority: 10,
      dedupeKey: nudgeId,
      targetRunId,
      parameters: {},
    },
    scheduledSequence: sequence,
    scheduledAt: "2026-08-03T00:00:00.000Z",
  };
}

const runtime = createRuntime();
const firstContext = policyContext("provider-policy-1");
const secondContext = policyContext("provider-policy-2");
const [firstReceipt, secondReceipt] = await Promise.all([
  runtime.coordinator.execute({
    context: firstContext,
    effects: [scheduleEffect("scheduled-one", "run-policy", 1)],
  }),
  runtime.coordinator.execute({
    context: secondContext,
    effects: [scheduleEffect("scheduled-two", "run-policy", 2)],
  }),
]);
assert.equal(firstReceipt.effectCount, 1);
assert.equal(secondReceipt.effectCount, 1);
assert.deepEqual(
  (await runtime.store.list()).map((item) => item.id),
  ["scheduled-one", "scheduled-two"],
);

await runtime.coordinator.execute({
  context: policyContext("provider-expire"),
  effects: [{
    kind: "nudge_expire",
    policyId: "policy.nudge",
    conversationId: "conversation-policy",
    runId: "run-policy",
    targetRunId: "run-policy",
    evaluatedAt: "2026-08-03T00:00:03.000Z",
    currentTurnNumber: 2,
    runEnded: true,
  }],
});
assert.deepEqual(
  (await runtime.store.list()).map((item) => item.state),
  [PENDING_NUDGE_STATE.expired, PENDING_NUDGE_STATE.expired],
);

const supersedeRuntime = createRuntime();
await supersedeRuntime.coordinator.execute({
  context: firstContext,
  effects: [scheduleEffect("superseded", "run-policy", 1)],
});
await supersedeRuntime.coordinator.execute({
  context: firstContext,
  effects: [{
    kind: "nudge_supersede",
    policyId: "policy.nudge",
    conversationId: "conversation-policy",
    runId: "run-policy",
    targetRunId: "run-policy",
    nudgeId: "superseded",
    supersededByNudgeId: "replacement",
    supersededAt: "2026-08-03T00:00:04.000Z",
  }],
});
assert.equal(
  (await supersedeRuntime.store.list())[0].state,
  PENDING_NUDGE_STATE.superseded,
);

const acknowledgementRuntime = createRuntime();
await acknowledgementRuntime.coordinator.execute({
  context: firstContext,
    effects: [scheduleEffect("acknowledged", "run-policy", 1, "until_acknowledged")],
});
await acknowledgementRuntime.manager.leaseForProviderCall({
  providerCallId: "provider-acknowledged",
  targetRunId: "run-policy",
  requestedAt: "2026-08-03T00:00:01.000Z",
});
await acknowledgementRuntime.manager.confirmDelivered(
  "provider-acknowledged",
  "2026-08-03T00:00:02.000Z",
);
const scheduledAcknowledgement = (await acknowledgementRuntime.store.list())[0];
assert.equal(scheduledAcknowledgement.state, PENDING_NUDGE_STATE.active);
await acknowledgementRuntime.coordinator.execute({
  context: firstContext,
  effects: [{
    kind: "nudge_acknowledge",
    policyId: "policy.nudge",
    conversationId: "conversation-policy",
    runId: "run-policy",
    nudgeId: "acknowledged",
    acknowledgementRef: { id: "ack.acknowledged", version: "1" },
    acknowledgedAt: "2026-08-03T00:00:03.000Z",
  }],
});
assert.equal(
  (await acknowledgementRuntime.store.list())[0].state,
  PENDING_NUDGE_STATE.acknowledged,
);

const conditionRuntime = createRuntime();
await conditionRuntime.coordinator.execute({
  context: firstContext,
  effects: [scheduleEffect("resolved", "run-policy", 1, "until_condition")],
});
await conditionRuntime.manager.leaseForProviderCall({
  providerCallId: "provider-resolved",
  targetRunId: "run-policy",
  requestedAt: "2026-08-03T00:00:01.000Z",
});
await conditionRuntime.manager.confirmDelivered(
  "provider-resolved",
  "2026-08-03T00:00:02.000Z",
);
await conditionRuntime.coordinator.execute({
  context: firstContext,
  effects: [{
    kind: "nudge_resolve",
    policyId: "policy.nudge",
    conversationId: "conversation-policy",
    runId: "run-policy",
    nudgeId: "resolved",
    conditionRef: { id: "condition.resolved", version: "1" },
    resolvedAt: "2026-08-03T00:00:03.000Z",
  }],
});
assert.equal(
  (await conditionRuntime.store.list())[0].state,
  PENDING_NUDGE_STATE.resolved,
);

const missingHandler = new RuntimeEffectCoordinator({
  conversationId: "conversation-policy",
});
await assert.rejects(
  () => missingHandler.execute({
    context: firstContext,
    effects: [{
      kind: "nudge_expire",
      policyId: "policy.nudge",
      conversationId: "conversation-policy",
      runId: "run-policy",
      targetRunId: "run-policy",
      evaluatedAt: "2026-08-03T00:00:03.000Z",
    }],
  }),
  (error) =>
    error instanceof RuntimeEffectCoordinatorError &&
    error.failure === RUNTIME_EFFECT_COORDINATOR_FAILURE.nudgeLifecycleHandlerMissing,
);

console.log("runtime policy nudge effect execution smoke: passed");
