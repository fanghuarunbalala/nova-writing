/** Provider-neutral Runtime Policy contracts for deterministic evaluation. */
import type {
  NudgeAcknowledgementReference,
  NudgeConditionReference,
  NudgeEffect,
} from "../nudge/index.js";
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

export interface NudgeSchedulePolicyEffect {
  readonly kind: "nudge_schedule";
  readonly policyId: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly nudgeId: string;
  readonly effect: NudgeEffect;
  readonly scheduledSequence: number;
  readonly scheduledAt: string;
}

export interface NudgeAcknowledgePolicyEffect {
  readonly kind: "nudge_acknowledge";
  readonly policyId: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly nudgeId: string;
  readonly acknowledgementRef: NudgeAcknowledgementReference;
  readonly acknowledgedAt: string;
}

export interface NudgeResolvePolicyEffect {
  readonly kind: "nudge_resolve";
  readonly policyId: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly nudgeId: string;
  readonly conditionRef: NudgeConditionReference;
  readonly resolvedAt: string;
}

export interface NudgeExpirePolicyEffect {
  readonly kind: "nudge_expire";
  readonly policyId: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly targetRunId: string;
  readonly evaluatedAt: string;
  readonly currentTurnNumber?: number;
  readonly runEnded?: boolean;
}

export interface NudgeSupersedePolicyEffect {
  readonly kind: "nudge_supersede";
  readonly policyId: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly nudgeId: string;
  readonly targetRunId: string;
  readonly supersededByNudgeId: string;
  readonly supersededAt: string;
}

export type RuntimeNudgeLifecycleEffect =
  | NudgeSchedulePolicyEffect
  | NudgeAcknowledgePolicyEffect
  | NudgeResolvePolicyEffect
  | NudgeExpirePolicyEffect
  | NudgeSupersedePolicyEffect;

export type RuntimePolicyEffect =
  | NudgeEffect
  | RuntimeNudgeLifecycleEffect
  | ContextCompactionEffect;

export interface RuntimePolicy {
  readonly id: string;
  readonly phases: readonly RuntimePolicyPhase[];

  evaluate(
    context: RuntimePolicyContext,
    state: RuntimePolicyState,
  ): readonly RuntimePolicyEffect[];
}
