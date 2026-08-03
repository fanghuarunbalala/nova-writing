/** Serializes and routes accepted Runtime Policy effects for one Conversation. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type { NudgeEffect } from "../nudge/index.js";
import type {
  ContextCompactionEffect,
  RuntimeNudgeLifecycleEffect,
  RuntimePolicyContext,
  RuntimePolicyEffect,
} from "./RuntimePolicyProtocol.js";
import {
  captureRuntimePolicyContext,
  captureRuntimePolicyEffect,
} from "./RuntimePolicyProtocolValidator.js";
import {
  RUNTIME_EFFECT_COORDINATOR_FAILURE,
  RuntimeEffectCoordinatorError,
  type RuntimeEffectCoordinatorFailure,
} from "./RuntimeEffectCoordinatorErrors.js";

export interface RuntimeNudgeEffectHandler {
  handle(context: RuntimePolicyContext, effect: NudgeEffect): Promise<void>;
}

export interface RuntimeNudgeLifecycleEffectHandler {
  handle(
    context: RuntimePolicyContext,
    effect: RuntimeNudgeLifecycleEffect,
  ): Promise<void>;
}

export interface RuntimeContextCompactionEffectHandler {
  handle(
    context: RuntimePolicyContext,
    effect: ContextCompactionEffect,
  ): Promise<void>;
}

export interface RuntimeEffectExecutionRequest {
  readonly context: RuntimePolicyContext;
  readonly effects: readonly RuntimePolicyEffect[];
}

export interface RuntimeEffectExecutionReceipt {
  readonly conversationId: string;
  readonly runId: string;
  readonly providerCallId: string;
  readonly phase: RuntimePolicyContext["phase"];
  readonly effectCount: number;
}

export interface RuntimeEffectCoordinatorOptions {
  readonly conversationId: string;
  readonly nudgeHandler?: RuntimeNudgeEffectHandler;
  readonly nudgeLifecycleHandler?: RuntimeNudgeLifecycleEffectHandler;
  readonly contextCompactionHandler?: RuntimeContextCompactionEffectHandler;
  readonly logger?: Logger;
}

export class RuntimeEffectCoordinator {
  private readonly conversationId: string;
  private readonly nudgeHandler?: RuntimeNudgeEffectHandler;
  private readonly nudgeLifecycleHandler?: RuntimeNudgeLifecycleEffectHandler;
  private readonly contextCompactionHandler?: RuntimeContextCompactionEffectHandler;
  private readonly logger: Logger;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: RuntimeEffectCoordinatorOptions) {
    if (!isNonBlank(options?.conversationId)) {
      throw new TypeError("Runtime Effect Coordinator conversationId is invalid");
    }
    this.conversationId = options.conversationId;
    this.nudgeHandler = options.nudgeHandler;
    this.nudgeLifecycleHandler = options.nudgeLifecycleHandler;
    this.contextCompactionHandler = options.contextCompactionHandler;
    this.logger = (options.logger ?? noopLogger).child({
      component: "runtime_effect_coordinator",
      conversationId: this.conversationId,
    });
  }

  async execute(
    request: RuntimeEffectExecutionRequest,
  ): Promise<RuntimeEffectExecutionReceipt> {
    let context: RuntimePolicyContext;
    let effects: readonly RuntimePolicyEffect[];
    try {
      context = captureRuntimePolicyContext(request?.context);
      if (
        context.conversationId !== this.conversationId ||
        !Array.isArray(request?.effects)
      ) {
        throw new Error();
      }
      effects = Object.freeze(
        request.effects.map((effect) => {
          const captured = captureRuntimePolicyEffect(effect);
          assertEffectContext(captured, context);
          return captured;
        }),
      );
    } catch {
      const error = this.failure(
        RUNTIME_EFFECT_COORDINATOR_FAILURE.invalidRequest,
        request?.context,
      );
      this.logFailure(error);
      throw error;
    }

    return this.serialize(async () => {
      if (effects.length === 0) {
        this.logger.debug("runtime.effect.execution_skipped", {
          runId: context.runId,
          providerCallId: context.providerCallId,
          phase: context.phase,
        });
      } else {
        this.logger.info("runtime.effect.execution_started", {
          runId: context.runId,
          providerCallId: context.providerCallId,
          phase: context.phase,
          effectCount: effects.length,
        });
      }
      for (const effect of effects) await this.executeOne(context, effect);
      const receipt = Object.freeze({
        conversationId: context.conversationId,
        runId: context.runId,
        providerCallId: context.providerCallId,
        phase: context.phase,
        effectCount: effects.length,
      });
      this.logger.info("runtime.effect.execution_completed", receipt);
      return receipt;
    });
  }

  async drain(): Promise<void> {
    await this.tail;
  }

  private async executeOne(
    context: RuntimePolicyContext,
    effect: RuntimePolicyEffect,
  ): Promise<void> {
    if (effect.kind === "nudge") {
      if (!this.nudgeHandler) {
        throw this.failEffect(
          RUNTIME_EFFECT_COORDINATOR_FAILURE.nudgeHandlerMissing,
          context,
          effect,
        );
      }
      try {
        await this.nudgeHandler.handle(context, effect);
        this.logHandled(context, effect);
        return;
      } catch (error) {
        if (error instanceof RuntimeEffectCoordinatorError) throw error;
        throw this.failEffect(
          RUNTIME_EFFECT_COORDINATOR_FAILURE.nudgeFailed,
          context,
          effect,
        );
      }
    }

    if (effect.kind !== "context_compaction") {
      if (!this.nudgeLifecycleHandler) {
        throw this.failEffect(
          RUNTIME_EFFECT_COORDINATOR_FAILURE.nudgeLifecycleHandlerMissing,
          context,
          effect,
        );
      }
      try {
        await this.nudgeLifecycleHandler.handle(context, effect);
        this.logHandled(context, effect);
        return;
      } catch (error) {
        if (error instanceof RuntimeEffectCoordinatorError) throw error;
        throw this.failEffect(
          RUNTIME_EFFECT_COORDINATOR_FAILURE.nudgeLifecycleFailed,
          context,
          effect,
        );
      }
    }

    if (!this.contextCompactionHandler) {
      throw this.failEffect(
        RUNTIME_EFFECT_COORDINATOR_FAILURE.compactionHandlerMissing,
        context,
        effect,
      );
    }
    try {
      await this.contextCompactionHandler.handle(context, effect);
      this.logHandled(context, effect);
    } catch (error) {
      if (error instanceof RuntimeEffectCoordinatorError) throw error;
      throw this.failEffect(
        RUNTIME_EFFECT_COORDINATOR_FAILURE.compactionFailed,
        context,
        effect,
      );
    }
  }

  private failEffect(
    failure: RuntimeEffectCoordinatorFailure,
    context: RuntimePolicyContext,
    effect: RuntimePolicyEffect,
  ): RuntimeEffectCoordinatorError {
    const error = this.failure(failure, context, effect);
    this.logFailure(error);
    return error;
  }

  private failure(
    failure: RuntimeEffectCoordinatorFailure,
    context?: Partial<RuntimePolicyContext>,
    effect?: Partial<RuntimePolicyEffect>,
  ): RuntimeEffectCoordinatorError {
    return new RuntimeEffectCoordinatorError(
      failure,
      this.conversationId,
      captureNonBlank(context?.runId),
      captureNonBlank(context?.providerCallId),
      captureNonBlank(effect?.policyId),
      effect?.kind === "nudge" ||
      effect?.kind === "context_compaction" ||
      effect?.kind === "nudge_schedule" ||
      effect?.kind === "nudge_acknowledge" ||
      effect?.kind === "nudge_resolve" ||
      effect?.kind === "nudge_expire" ||
      effect?.kind === "nudge_supersede"
        ? effect.kind
        : undefined,
    );
  }

  private logHandled(
    context: RuntimePolicyContext,
    effect: RuntimePolicyEffect,
  ): void {
    this.logger.debug("runtime.effect.handled", {
      runId: context.runId,
      providerCallId: context.providerCallId,
      policyId: effect.policyId,
      effectKind: effect.kind,
    });
  }

  private logFailure(error: RuntimeEffectCoordinatorError): void {
    this.logger.error("runtime.effect.execution_failed", {
      failure: error.failure,
      conversationId: error.conversationId,
      ...(error.runId ? { runId: error.runId } : {}),
      ...(error.providerCallId
        ? { providerCallId: error.providerCallId }
        : {}),
      ...(error.policyId ? { policyId: error.policyId } : {}),
      ...(error.effectKind ? { effectKind: error.effectKind } : {}),
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function assertEffectContext(
  effect: RuntimePolicyEffect,
  context: RuntimePolicyContext,
): void {
  if (effect.kind === "nudge") {
    if (effect.targetRunId !== context.runId) throw new Error();
    return;
  }
  if (effect.kind !== "context_compaction") {
    if (
      effect.conversationId !== context.conversationId ||
      effect.runId !== context.runId
    ) {
      throw new Error();
    }
    return;
  }
  if (
    effect.conversationId !== context.conversationId ||
    effect.runId !== context.runId ||
    effect.providerCallId !== context.providerCallId ||
    effect.requestedAt !== context.evaluatedAt
  ) {
    throw new Error();
  }
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function captureNonBlank(value: unknown): string | undefined {
  return isNonBlank(value) ? value : undefined;
}
