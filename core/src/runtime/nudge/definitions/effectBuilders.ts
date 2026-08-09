/**
 * 共享的 nudge policy 效果构造器：保证同 run 内 scheduledSequence 全局唯一
 * （store 要求 sequence 不重复，多个 policy 不能各自从 1 起）。
 */
import type {
  NudgeAcknowledgePolicyEffect,
  NudgeSchedulePolicyEffect,
} from "../../policy/index.js";
import type {
  NudgeAcknowledgementReference,
  NudgeEffect,
} from "../index.js";

let nextScheduledSequence = 0;

export interface CreateNudgeScheduleEffectInput {
  readonly policyId: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly nudgeId: string;
  readonly effect: NudgeEffect;
  readonly evaluatedAt: string;
}

export function createNudgeScheduleEffect(
  input: CreateNudgeScheduleEffectInput,
): NudgeSchedulePolicyEffect {
  nextScheduledSequence += 1;
  return Object.freeze({
    kind: "nudge_schedule",
    policyId: input.policyId,
    conversationId: input.conversationId,
    runId: input.runId,
    nudgeId: input.nudgeId,
    effect: input.effect,
    scheduledSequence: nextScheduledSequence,
    scheduledAt: input.evaluatedAt,
  });
}

export interface CreateNudgeAcknowledgeEffectInput {
  readonly policyId: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly nudgeId: string;
  readonly acknowledgementRef: NudgeAcknowledgementReference;
  readonly acknowledgedAt: string;
}

export function createNudgeAcknowledgeEffect(
  input: CreateNudgeAcknowledgeEffectInput,
): NudgeAcknowledgePolicyEffect {
  return Object.freeze({
    kind: "nudge_acknowledge",
    policyId: input.policyId,
    conversationId: input.conversationId,
    runId: input.runId,
    nudgeId: input.nudgeId,
    acknowledgementRef: input.acknowledgementRef,
    acknowledgedAt: input.acknowledgedAt,
  });
}
