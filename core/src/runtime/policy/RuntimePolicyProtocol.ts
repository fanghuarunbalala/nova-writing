/** Provider-neutral Runtime Policy contracts for deterministic evaluation. */
import type { JsonValue } from "../../event/index.js";
import type { ReminderKind } from "../../event/output/payload/SystemReminderAttachedPayload.js";
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

/** 域运行时信号：provider call 计数与可选快照，供 reminder 类 policy 输入。 */
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
  /** 域运行时信号（reminder 类 policy 输入）。 */
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

export interface SystemReminderAttachEffect {
  readonly kind: "system_reminder_attach";
  readonly policyId: string;
  readonly conversationId: string;
  readonly runId: string;
  /** 提醒稳定标识（同一种类新状态 = 新 id，旧记录不覆盖）。Stable reminder identity; a new state appends a new id. */
  readonly reminderId: string;
  /** 提醒种类。Reminder kind. */
  readonly reminderKind: ReminderKind;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly parameters: Readonly<Record<string, JsonValue>>;
  /** 消息流内排序序号（同一 provider 调用内多个提醒的稳定顺序）。Stable order within one provider call. */
  readonly order: number;
}

export type RuntimePolicyEffect =
  | SystemReminderAttachEffect
  | ContextCompactionEffect;

export interface RuntimePolicy {
  readonly id: string;
  readonly phases: readonly RuntimePolicyPhase[];

  evaluate(
    context: RuntimePolicyContext,
    state: RuntimePolicyState,
  ): readonly RuntimePolicyEffect[];
}
