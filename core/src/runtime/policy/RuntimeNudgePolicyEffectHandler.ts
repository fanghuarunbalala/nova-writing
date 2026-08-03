/** Applies typed Runtime Nudge Policy Effects exclusively through NudgeManager. */
import type {
  NudgeAcknowledgementRequest,
  NudgeConditionResolutionRequest,
  NudgeSupersessionRequest,
  NudgeManager,
} from "../nudge/index.js";
import type {
  RuntimeNudgeLifecycleEffect,
  RuntimePolicyContext,
} from "./RuntimePolicyProtocol.js";
import type { RuntimeNudgeLifecycleEffectHandler } from "./RuntimeEffectCoordinator.js";

export class RuntimeNudgePolicyEffectHandler
  implements RuntimeNudgeLifecycleEffectHandler
{
  private readonly manager: NudgeManager;

  constructor(manager: NudgeManager) {
    this.manager = manager;
  }

  async handle(
    context: RuntimePolicyContext,
    effect: RuntimeNudgeLifecycleEffect,
  ): Promise<void> {
    if (effect.conversationId !== context.conversationId || effect.runId !== context.runId) {
      throw new Error("Runtime Nudge Policy Effect identity is invalid");
    }
    switch (effect.kind) {
      case "nudge_schedule":
        await this.manager.schedule({
          nudgeId: effect.nudgeId,
          effect: effect.effect,
          scheduledSequence: effect.scheduledSequence,
          scheduledAt: effect.scheduledAt,
        });
        return;
      case "nudge_acknowledge":
        await this.manager.acknowledge({
          nudgeId: effect.nudgeId,
          targetRunId: effect.runId,
          acknowledgementRef: effect.acknowledgementRef,
          acknowledgedAt: effect.acknowledgedAt,
        } satisfies NudgeAcknowledgementRequest);
        return;
      case "nudge_resolve":
        await this.manager.resolveCondition({
          nudgeId: effect.nudgeId,
          targetRunId: effect.runId,
          conditionRef: effect.conditionRef,
          resolvedAt: effect.resolvedAt,
        } satisfies NudgeConditionResolutionRequest);
        return;
      case "nudge_expire":
        await this.manager.expire({
          targetRunId: effect.targetRunId,
          evaluatedAt: effect.evaluatedAt,
          ...(effect.currentTurnNumber === undefined
            ? {}
            : { currentTurnNumber: effect.currentTurnNumber }),
          ...(effect.runEnded === undefined ? {} : { runEnded: effect.runEnded }),
        });
        return;
      case "nudge_supersede":
        await this.manager.supersede({
          nudgeId: effect.nudgeId,
          targetRunId: effect.targetRunId,
          supersededByNudgeId: effect.supersededByNudgeId,
          supersededAt: effect.supersededAt,
        } satisfies NudgeSupersessionRequest);
        return;
    }
  }
}
