import assert from "node:assert/strict";
import {
  CONTEXT_BUDGET_DEFAULTS,
  CONTEXT_PRESSURE_LEVEL,
  RUNTIME_POLICY_ENGINE_FAILURE,
  RUNTIME_POLICY_PHASE,
  RuntimePolicyEngine,
  RuntimePolicyEngineError,
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
  id: "policy.lifecycle",
  phases: [RUNTIME_POLICY_PHASE.beforeProviderCall],
  evaluate: () => [
    {
      kind: "nudge_acknowledge",
      policyId: "policy.lifecycle",
      conversationId: "conversation-engine",
      runId: "run-engine",
      nudgeId: "nudge-ack",
      acknowledgementRef: { id: "ack.lifecycle", version: "1" },
      acknowledgedAt: "2026-08-03T00:00:00.000Z",
    },
    {
      kind: "nudge_resolve",
      policyId: "policy.lifecycle",
      conversationId: "conversation-engine",
      runId: "run-engine",
      nudgeId: "nudge-condition",
      conditionRef: { id: "condition.lifecycle", version: "1" },
      resolvedAt: "2026-08-03T00:00:00.000Z",
    },
    {
      kind: "nudge_expire",
      policyId: "policy.lifecycle",
      conversationId: "conversation-engine",
      runId: "run-engine",
      targetRunId: "run-engine",
      evaluatedAt: "2026-08-03T00:00:00.000Z",
      runEnded: true,
    },
    {
      kind: "nudge_supersede",
      policyId: "policy.lifecycle",
      conversationId: "conversation-engine",
      runId: "run-engine",
      targetRunId: "run-engine",
      nudgeId: "nudge-old",
      supersededByNudgeId: "nudge-new",
      supersededAt: "2026-08-03T00:00:00.000Z",
    },
  ],
};
const engine = new RuntimePolicyEngine({ policies: [policy] });
const effects = engine.evaluate(context(), { conversationId: "conversation-engine" });
assert.deepEqual(
  effects.map((effect) => effect.kind),
  ["nudge_acknowledge", "nudge_resolve", "nudge_expire", "nudge_supersede"],
);
assert.equal(effects.every((effect) => Object.isFrozen(effect)), true);

const invalidPolicy = new RuntimePolicyEngine({
  policies: [{
    id: "policy.invalid",
    phases: [RUNTIME_POLICY_PHASE.beforeProviderCall],
    evaluate: () => [{
      kind: "nudge_expire",
      policyId: "policy.invalid",
      conversationId: "conversation-engine",
      runId: "run-engine",
      targetRunId: "other-run",
      evaluatedAt: "2026-08-03T00:00:00.000Z",
    }],
  }],
});
assert.throws(
  () => invalidPolicy.evaluate(context(), { conversationId: "conversation-engine" }),
  (error) =>
    error instanceof RuntimePolicyEngineError &&
    error.failure === RUNTIME_POLICY_ENGINE_FAILURE.invalidEffect,
);

console.log("runtime policy nudge engine integration smoke: passed");
