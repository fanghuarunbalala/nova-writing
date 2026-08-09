/** Evaluates registered Runtime Policies in stable registration order without executing effects. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  RUNTIME_POLICY_PHASE,
  type RuntimePolicy,
  type RuntimePolicyContext,
  type RuntimePolicyEffect,
  type RuntimePolicyPhase,
  type RuntimePolicyState,
} from "./RuntimePolicyProtocol.js";
import {
  captureRuntimePolicyContext,
  captureRuntimePolicyEffect,
  captureRuntimePolicyState,
} from "./RuntimePolicyProtocolValidator.js";
import {
  RUNTIME_POLICY_ENGINE_FAILURE,
  RuntimePolicyEngineError,
  type RuntimePolicyEngineFailure,
} from "./RuntimePolicyEngineErrors.js";

const PHASES = new Set(Object.values(RUNTIME_POLICY_PHASE));

export interface RuntimePolicyEngineOptions {
  readonly policies?: readonly RuntimePolicy[];
  readonly logger?: Logger;
}

interface RegisteredRuntimePolicy extends RuntimePolicy {
  readonly phases: readonly RuntimePolicyPhase[];
}

export class RuntimePolicyEngine {
  private readonly policies: RegisteredRuntimePolicy[] = [];
  private readonly policyIds = new Set<string>();
  private readonly logger: Logger;

  constructor(options: RuntimePolicyEngineOptions = {}) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "runtime_policy_engine",
    });
    for (const policy of options.policies ?? []) this.register(policy);
  }

  register(policy: RuntimePolicy): void {
    const policyId = capturePolicyId(policy);
    if (policyId === undefined) {
      throw this.failure(RUNTIME_POLICY_ENGINE_FAILURE.invalidPolicy);
    }
    if (this.policyIds.has(policyId)) {
      throw this.failure(RUNTIME_POLICY_ENGINE_FAILURE.duplicatePolicy, policyId);
    }
    if (!isValidPolicy(policy)) {
      throw this.failure(RUNTIME_POLICY_ENGINE_FAILURE.invalidPolicy, policyId);
    }
    this.policies.push(
      Object.freeze({
        id: policyId,
        phases: Object.freeze([...policy.phases]),
        evaluate: policy.evaluate.bind(policy),
      }),
    );
    this.policyIds.add(policyId);
    this.logger.debug("runtime.policy.registered", {
      policyId,
      registrationIndex: this.policies.length - 1,
    });
  }

  evaluate(
    context: RuntimePolicyContext,
    state: RuntimePolicyState,
  ): readonly RuntimePolicyEffect[] {
    let capturedContext: RuntimePolicyContext;
    let capturedState: RuntimePolicyState;
    try {
      capturedContext = captureRuntimePolicyContext(context);
      capturedState = captureRuntimePolicyState(state);
      if (capturedState.conversationId !== capturedContext.conversationId) {
        throw new Error();
      }
    } catch {
      const error = this.failure(
        RUNTIME_POLICY_ENGINE_FAILURE.invalidEvaluation,
        undefined,
        context,
      );
      this.logFailure(error);
      throw error;
    }

    this.logger.debug("runtime.policy.evaluation_started", {
      conversationId: capturedContext.conversationId,
      runId: capturedContext.runId,
      providerCallId: capturedContext.providerCallId,
      phase: capturedContext.phase,
      ...(capturedContext.contextPressure
        ? { pressureLevel: capturedContext.contextPressure.level }
        : {}),
    });
    const effects: RuntimePolicyEffect[] = [];
    for (const policy of this.policies) {
      if (!policy.phases.includes(capturedContext.phase)) continue;
      let produced: readonly RuntimePolicyEffect[];
      try {
        produced = policy.evaluate(capturedContext, capturedState);
      } catch {
        const error = this.failure(
          RUNTIME_POLICY_ENGINE_FAILURE.policyFailed,
          policy.id,
          capturedContext,
        );
        this.logFailure(error);
        throw error;
      }
      if (!Array.isArray(produced)) {
        const error = this.failure(
          RUNTIME_POLICY_ENGINE_FAILURE.invalidEffect,
          policy.id,
          capturedContext,
        );
        this.logFailure(error);
        throw error;
      }
      for (const candidate of produced) {
        let effect: RuntimePolicyEffect;
        try {
          effect = captureRuntimePolicyEffect(candidate);
          assertEffectIdentity(effect, policy.id, capturedContext);
        } catch {
          const error = this.failure(
            RUNTIME_POLICY_ENGINE_FAILURE.invalidEffect,
            policy.id,
            capturedContext,
          );
          this.logFailure(error);
          throw error;
        }
        effects.push(effect);
      }
    }
    this.logger.info("runtime.policy.evaluation_completed", {
      conversationId: capturedContext.conversationId,
      runId: capturedContext.runId,
      providerCallId: capturedContext.providerCallId,
      phase: capturedContext.phase,
      effectCount: effects.length,
    });
    return Object.freeze(effects);
  }

  private failure(
    failure: RuntimePolicyEngineFailure,
    policyId?: string,
    context?: Partial<RuntimePolicyContext>,
  ): RuntimePolicyEngineError {
    return new RuntimePolicyEngineError(
      failure,
      policyId,
      captureNonBlank(context?.conversationId),
      captureNonBlank(context?.runId),
      captureNonBlank(context?.providerCallId),
    );
  }

  private logFailure(error: RuntimePolicyEngineError): void {
    this.logger.error("runtime.policy.evaluation_failed", {
      failure: error.failure,
      ...(error.policyId ? { policyId: error.policyId } : {}),
      ...(error.conversationId
        ? { conversationId: error.conversationId }
        : {}),
      ...(error.runId ? { runId: error.runId } : {}),
      ...(error.providerCallId
        ? { providerCallId: error.providerCallId }
        : {}),
    });
  }
}

function isValidPolicy(policy: RuntimePolicy): boolean {
  return (
    policy !== null &&
    typeof policy === "object" &&
    Array.isArray(policy.phases) &&
    policy.phases.length > 0 &&
    new Set(policy.phases).size === policy.phases.length &&
    policy.phases.every((phase) => PHASES.has(phase as RuntimePolicyPhase)) &&
    typeof policy.evaluate === "function"
  );
}

function capturePolicyId(policy: RuntimePolicy): string | undefined {
  return captureNonBlank(policy?.id);
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function assertEffectIdentity(
  effect: RuntimePolicyEffect,
  policyId: string,
  context: RuntimePolicyContext,
): void {
  if (effect.policyId !== policyId) throw new Error();
  if (effect.kind === "nudge_schedule") {
    if (
      effect.conversationId !== context.conversationId ||
      effect.runId !== context.runId ||
      effect.effect.targetRunId !== context.runId ||
      effect.scheduledAt !== context.evaluatedAt
    ) {
      throw new Error();
    }
    return;
  }
  if (
    effect.kind === "nudge_acknowledge" ||
    effect.kind === "nudge_resolve" ||
    effect.kind === "nudge_expire" ||
    effect.kind === "nudge_supersede"
  ) {
    if (effect.conversationId !== context.conversationId || effect.runId !== context.runId) {
      throw new Error();
    }
    return;
  }
  if (effect.kind === "nudge") {
    if (effect.targetRunId === context.runId) return;
    throw new Error();
  }
  if (
    effect.kind !== "context_compaction" ||
    effect.conversationId !== context.conversationId ||
    effect.runId !== context.runId ||
    effect.providerCallId !== context.providerCallId ||
    effect.requestedAt !== context.evaluatedAt
  ) {
    throw new Error();
  }
}
