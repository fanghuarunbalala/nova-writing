/** Publishes redacted durable lifecycle Events around one Compaction request. */
import {
  ContextCompactionCompletedOutputEvent,
  ContextCompactionFailedOutputEvent,
  ContextCompactionStartedOutputEvent,
  OUTPUT_EVENT_TYPE,
} from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { RuntimeEventAppendReceipt, RuntimeEventSink } from "../execution/index.js";
import { CONTEXT_COMPACTION_EFFECT_TRIGGER, type ContextCompactionEffect, type RuntimePolicyContext } from "../policy/index.js";
import type { RuntimeContextCompactionEffectHandler } from "../policy/RuntimeEffectCoordinator.js";
import { ContextCompactionManager } from "./ContextCompactionManager.js";
import { ContextCompactionManagerError } from "./ContextCompactionManagerErrors.js";
import { CONTEXT_COMPACTION_MANAGER_DISPOSITION, type ContextCompactionClock } from "./ContextCompactionManagerProtocol.js";

export interface ContextCompactionLifecycleEventIdFactory { create(input: { conversationId: string; runId: string; providerCallId: string; eventType: string }): string; }
export interface ContextCompactionLifecycleCoordinatorOptions { manager: ContextCompactionManager; eventSink: RuntimeEventSink; eventIdFactory: ContextCompactionLifecycleEventIdFactory; clock: ContextCompactionClock; logger?: Logger; }

export class ContextCompactionLifecycleCoordinator implements RuntimeContextCompactionEffectHandler {
  private readonly logger: Logger;
  constructor(private readonly options: ContextCompactionLifecycleCoordinatorOptions) { this.logger = (options.logger ?? noopLogger).child({ component: "context_compaction_lifecycle_coordinator" }); }

  async handle(context: RuntimePolicyContext, effect: ContextCompactionEffect): Promise<void> {
    let result;
    try { result = await this.options.manager.compact(effect); }
    catch (error) {
      await this.publishStarted(effect);
      await this.publishFailed(effect, error instanceof ContextCompactionManagerError ? error.failure : "operation_failed", this.options.clock.now());
      throw error;
    }
    if (result.disposition === CONTEXT_COMPACTION_MANAGER_DISPOSITION.duplicate) return;
    await this.publishStarted(effect);
    if (result.disposition === CONTEXT_COMPACTION_MANAGER_DISPOSITION.activated && result.checkpoint && result.assessment) {
      await this.append(new ContextCompactionCompletedOutputEvent({ conversationId: effect.conversationId, runId: effect.runId, id: this.id(effect, OUTPUT_EVENT_TYPE.contextCompactionCompleted), timestamp: result.assessment.completedAt, providerCallId: effect.providerCallId, checkpointId: result.checkpoint.id, outcome: result.assessment.outcome as "target_met" | "reduced" | "degraded", sourceStartSequence: result.checkpoint.sourceStartSequence, sourceEndSequence: result.checkpoint.sourceEndSequence, tokenEstimateBefore: result.assessment.tokenEstimateBefore, tokenEstimateAfter: result.assessment.tokenEstimateAfter }));
      return;
    }
    await this.publishFailed(effect, result.assessment?.unreducibleReason ?? "context_unreducible", result.assessment?.completedAt ?? this.options.clock.now(), result.assessment?.tokenEstimateAfter);
  }

  private publishStarted(effect: ContextCompactionEffect): Promise<RuntimeEventAppendReceipt> { return this.append(new ContextCompactionStartedOutputEvent({ conversationId: effect.conversationId, runId: effect.runId, id: this.id(effect, OUTPUT_EVENT_TYPE.contextCompactionStarted), timestamp: effect.requestedAt, providerCallId: effect.providerCallId, trigger: effect.trigger === CONTEXT_COMPACTION_EFFECT_TRIGGER.hardAdmissionRisk ? "hard_admission_risk" : "automatic", tokenEstimateBefore: effect.pressure.estimate.totalInputTokens, targetTokens: effect.targetTokens, hardAdmissionTokens: effect.hardAdmissionTokens })); }
  private publishFailed(effect: ContextCompactionEffect, failure: string, timestamp: string, tokenEstimateAfter?: number): Promise<RuntimeEventAppendReceipt> { return this.append(new ContextCompactionFailedOutputEvent({ conversationId: effect.conversationId, runId: effect.runId, id: this.id(effect, OUTPUT_EVENT_TYPE.contextCompactionFailed), timestamp, providerCallId: effect.providerCallId, failure, tokenEstimateBefore: effect.pressure.estimate.totalInputTokens, ...(tokenEstimateAfter === undefined ? {} : { tokenEstimateAfter }) })); }
  private id(effect: ContextCompactionEffect, eventType: string): string { return this.options.eventIdFactory.create({ conversationId: effect.conversationId, runId: effect.runId, providerCallId: effect.providerCallId, eventType }); }
  private async append(event: Parameters<RuntimeEventSink["append"]>[0]): Promise<RuntimeEventAppendReceipt> { try { return await this.options.eventSink.append(event); } catch { this.logger.error("runtime.context.compaction_event_append_failed", { conversationId: event.conversationId, eventType: event.getEventType() }); throw new ContextCompactionLifecycleCoordinatorError(); } }
}
export class ContextCompactionLifecycleCoordinatorError extends Error { override readonly name = "ContextCompactionLifecycleCoordinatorError"; readonly code = "CONTEXT_COMPACTION_LIFECYCLE_FAILED" as const; constructor() { super("Context Compaction lifecycle publication failed"); } }
