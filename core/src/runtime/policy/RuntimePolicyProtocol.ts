/** Provider-neutral Runtime Policy contracts for deterministic evaluation. */
import type {
  NudgeAcknowledgementReference,
  NudgeConditionReference,
  NudgeEffect,
} from "../nudge/index.js";
import type { ContextPressureSnapshot } from "../context/index.js";
import type { ComposeModeSnapshot } from "../compose/ComposeModeState.js";

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

/** 域运行时信号：provider call 计数与可选快照，供 nudge 类 policy 输入。 */
export interface RuntimePolicyRuntimeSignals {
  /** 本 run 内已发出的 provider call 序号（1-based；对应 ActivePiRun.providerCallOrdinal）。 */
  readonly providerCallCount: number;
  /** compose 模式快照（novel.reminder.compose_mode/compose_mode_exit 输入）。 */
  readonly compose?: ComposeModeSnapshot;
  /** todo 计数（novel.reminder.todo_idle 输入；lastUpdatedRunId = 最后一次 TodoWrite 所在 run）。 */
  readonly todos?: Readonly<{ inProgressCount: number; lastUpdatedRunId?: string }>;
}

export interface RuntimePolicyContext {
  readonly phase: RuntimePolicyPhase;
  readonly conversationId: string;
  readonly runId: string;
  readonly providerCallId: string;
  readonly evaluatedAt: string;
  /** 上下文压力快照（ContextPressurePolicy 专用；其余 policy 可省略）。 */
  readonly contextPressure?: ContextPressureSnapshot;
  /** 域运行时信号（nudge 类 policy 输入）。 */
  readonly runtimeSignals?: RuntimePolicyRuntimeSignals;
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
