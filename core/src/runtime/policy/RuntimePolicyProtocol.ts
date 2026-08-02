/** Provider-neutral Runtime Policy contracts for deterministic evaluation. */
import type { NudgeEffect } from "../nudge/index.js";
import type { ContextPressureSnapshot } from "../context/index.js";

export const RUNTIME_POLICY_PHASE = {
  beforeProviderCall: "before_provider_call",
} as const;

export type RuntimePolicyPhase =
  (typeof RUNTIME_POLICY_PHASE)[keyof typeof RUNTIME_POLICY_PHASE];

export const CONTEXT_COMPACTION_EFFECT_TRIGGER = {
  requestThreshold: "request_threshold",
  hardAdmissionRisk: "hard_admission_risk",
} as const;

export type ContextCompactionEffectTrigger =
  (typeof CONTEXT_COMPACTION_EFFECT_TRIGGER)[keyof typeof CONTEXT_COMPACTION_EFFECT_TRIGGER];

export interface RuntimePolicyContext {
  readonly phase: RuntimePolicyPhase;
  readonly conversationId: string;
  readonly runId: string;
  readonly providerCallId: string;
  readonly evaluatedAt: string;
  readonly contextPressure: ContextPressureSnapshot;
}

export interface ContextCompactionPolicyState {
  readonly lastAutomaticCompactionAt: string;
  readonly newContentSinceLastAutomaticCompactionTokens: number;
}

export interface RuntimePolicyState {
  readonly conversationId: string;
  readonly contextCompaction?: ContextCompactionPolicyState;
}

export interface ContextCompactionEffect {
  readonly kind: "context_compaction";
  readonly policyId: string;
  readonly trigger: ContextCompactionEffectTrigger;
  readonly conversationId: string;
  readonly runId: string;
  readonly providerCallId: string;
  readonly requestedAt: string;
  readonly pressure: ContextPressureSnapshot;
  readonly targetTokens: number;
  readonly compactionRequestTokens: number;
  readonly hardAdmissionTokens: number;
  readonly minimumSavingsTokens: number;
  readonly automaticHysteresisTokens: number;
}

export type RuntimePolicyEffect = NudgeEffect | ContextCompactionEffect;

export interface RuntimePolicy {
  readonly id: string;
  readonly phases: readonly RuntimePolicyPhase[];

  evaluate(
    context: RuntimePolicyContext,
    state: RuntimePolicyState,
  ): readonly RuntimePolicyEffect[];
}
