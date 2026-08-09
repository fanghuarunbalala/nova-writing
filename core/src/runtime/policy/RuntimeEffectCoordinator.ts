/** Serializes and routes accepted Runtime Policy effects for one Conversation. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type { ReminderKind } from "../../event/output/payload/SystemReminderAttachedPayload.js";
import type {
  ContextCompactionEffect,
  RuntimePolicyContext,
  RuntimePolicyEffect,
  SystemReminderAttachEffect,
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

export interface RuntimeReminderAttachment {
  readonly reminderId: string;
  readonly kind: ReminderKind;
  readonly content: string;
  readonly order: number;
}

export interface RuntimeSystemReminderAttachEffectHandler {
  handle(
    context: RuntimePolicyContext,
    effect: SystemReminderAttachEffect,
  ): Promise<RuntimeReminderAttachment>;
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
  /** 本 provider 调用已附加的 reminder（同 run 注入凭据）。Attached reminders this provider call. */
  readonly attachedReminders: readonly RuntimeReminderAttachment[];
}

export interface RuntimeEffectCoordinatorOptions {
  readonly conversationId: string;
  readonly systemReminderAttachHandler?: RuntimeSystemReminderAttachEffectHandler;
  readonly contextCompactionHandler?: RuntimeContextCompactionEffectHandler;
  readonly logger?: Logger;
}

export class RuntimeEffectCoordinator {
  private readonly conversationId: string;
  private readonly systemReminderAttachHandler?: RuntimeSystemReminderAttachEffectHandler;
  private readonly contextCompactionHandler?: RuntimeContextCompactionEffectHandler;
  private readonly logger: Logger;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: RuntimeEffectCoordinatorOptions) {
    if (!isNonBlank(options?.conversationId)) {
      throw new TypeError("Runtime Effect Coordinator conversationId is invalid");
    }
    this.conversationId = options.conversationId;
    this.systemReminderAttachHandler = options.systemReminderAttachHandler;
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
      const attachedReminders: RuntimeReminderAttachment[] = [];
      for (const effect of effects) {
        const attachment = await this.executeOne(context, effect);
        if (attachment !== undefined) attachedReminders.push(attachment);
      }
      const receipt = Object.freeze({
        conversationId: context.conversationId,
        runId: context.runId,
        providerCallId: context.providerCallId,
        phase: context.phase,
        effectCount: effects.length,
        attachedReminders: Object.freeze(attachedReminders),
      });
      this.logger.info("runtime.effect.execution_completed", {
        conversationId: receipt.conversationId,
        runId: receipt.runId,
        providerCallId: receipt.providerCallId,
        phase: receipt.phase,
        effectCount: receipt.effectCount,
        attachedReminderCount: receipt.attachedReminders.length,
      });
      return receipt;
    });
  }

  async drain(): Promise<void> {
    await this.tail;
  }

  private async executeOne(
    context: RuntimePolicyContext,
    effect: RuntimePolicyEffect,
  ): Promise<RuntimeReminderAttachment | undefined> {
    if (effect.kind === "system_reminder_attach") {
      if (!this.systemReminderAttachHandler) {
        throw this.failEffect(
          RUNTIME_EFFECT_COORDINATOR_FAILURE.systemReminderAttachHandlerMissing,
          context,
          effect,
        );
      }
      try {
        const attachment =
          await this.systemReminderAttachHandler.handle(context, effect);
        this.logHandled(context, effect);
        return attachment;
      } catch (error) {
        if (error instanceof RuntimeEffectCoordinatorError) throw error;
        throw this.failEffect(
          RUNTIME_EFFECT_COORDINATOR_FAILURE.systemReminderAttachFailed,
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
      return undefined;
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
      effect?.kind === "system_reminder_attach" ||
      effect?.kind === "context_compaction"
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
  if (effect.kind === "system_reminder_attach") {
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
