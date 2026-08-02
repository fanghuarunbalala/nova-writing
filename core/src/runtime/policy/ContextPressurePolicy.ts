/** Converts accepted per-call Context pressure into deterministic Compaction requests. */
import { CONTEXT_PRESSURE_LEVEL } from "../context/index.js";
import {
  CONTEXT_COMPACTION_EFFECT_TRIGGER,
  RUNTIME_POLICY_PHASE,
  type ContextCompactionEffect,
  type RuntimePolicy,
  type RuntimePolicyContext,
  type RuntimePolicyEffect,
  type RuntimePolicyState,
} from "./RuntimePolicyProtocol.js";
import { calculateContextPolicyTokenBoundaries } from "./RuntimePolicyProtocolValidator.js";

export const CONTEXT_PRESSURE_POLICY_ID = "context_pressure";

export class ContextPressurePolicy implements RuntimePolicy {
  readonly id = CONTEXT_PRESSURE_POLICY_ID;
  readonly phases = Object.freeze([RUNTIME_POLICY_PHASE.beforeProviderCall]);

  evaluate(
    context: RuntimePolicyContext,
    state: RuntimePolicyState,
  ): readonly RuntimePolicyEffect[] {
    if (context.phase !== RUNTIME_POLICY_PHASE.beforeProviderCall) return [];

    const pressure = context.contextPressure;
    const boundaries = calculateContextPolicyTokenBoundaries(pressure);
    if (pressure.irreducibleFloor.totalTokens >= boundaries.hardAdmissionTokens) {
      return [];
    }
    if (
      pressure.level === CONTEXT_PRESSURE_LEVEL.normal ||
      pressure.level === CONTEXT_PRESSURE_LEVEL.soft
    ) {
      return [];
    }

    const hardAdmissionRisk = pressure.level === CONTEXT_PRESSURE_LEVEL.hard;
    const compactionState = state.contextCompaction;
    if (
      !hardAdmissionRisk &&
      compactionState !== undefined &&
      compactionState.newContentSinceLastAutomaticCompactionTokens <
        boundaries.automaticHysteresisTokens
    ) {
      return [];
    }

    const effect: ContextCompactionEffect = Object.freeze({
      kind: "context_compaction",
      policyId: this.id,
      trigger: hardAdmissionRisk
        ? CONTEXT_COMPACTION_EFFECT_TRIGGER.hardAdmissionRisk
        : CONTEXT_COMPACTION_EFFECT_TRIGGER.requestThreshold,
      conversationId: context.conversationId,
      runId: context.runId,
      providerCallId: context.providerCallId,
      requestedAt: context.evaluatedAt,
      pressure,
      ...boundaries,
    });
    return Object.freeze([effect]);
  }
}
