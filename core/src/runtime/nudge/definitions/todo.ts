/**
 * todo_idle 的集中定义：手写 Policy 类 + 模板同文件。
 *
 * 触发：inProgressCount > 0 持续 ≥3 条 provider call（latch 记录首个 provider
 * call；累计在途 call 数 `providerCallCount - sinceProviderCall + 1` 达到
 * TODO_IDLE_SUSTAINED_PROVIDER_CALLS 且未 schedule → schedule）。
 * 关闭：inProgressCount === 0 → 清 latch + acknowledge 关闭 pending。
 * 进行中：until_acknowledged + cooldownTurns=3 由选择器按交付 turn 重交付。
 */
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  RUNTIME_POLICY_PHASE,
  type RuntimePolicy,
  type RuntimePolicyContext,
  type RuntimePolicyEffect,
  type RuntimePolicyState,
} from "../../policy/index.js";
import type { NudgeAcknowledgementReference, NudgeEffect } from "../index.js";
import { NUDGE_DELIVERY } from "../NudgeProtocol.js";
import type { NudgeTemplate } from "../NudgeTemplateRegistry.js";
import type { NudgeDefinition } from "./NudgeDefinition.js";
import {
  createNudgeAcknowledgeEffect,
  createNudgeScheduleEffect,
} from "./effectBuilders.js";

/** RuntimePolicy.id；引擎断言 effect.policyId === policy.id。 */
const TODO_IDLE_POLICY_ID = "todo_idle";

export const TODO_IDLE_NUDGE_ID = "novel.reminder.todo_idle";
export const TODO_IDLE_NUDGE_VERSION = "1.0.0";
/** 工具组守卫：必须 ∈ manifest tools.groupIds（runtime.todo 工具组）。 */
export const TODO_IDLE_TOOL_GROUP = "runtime.todo";
/** in_progress 持续多少条 provider call 后才触发。 */
export const TODO_IDLE_SUSTAINED_PROVIDER_CALLS = 3;
/** 触发后重交付的 cooldown（provider call 单位）。 */
export const TODO_IDLE_COOLDOWN_TURNS = 3;
export const TODO_IDLE_NUDGE_PRIORITY = 30;
export const TODO_IDLE_ACKNOWLEDGEMENT_REF: NudgeAcknowledgementReference =
  Object.freeze({
    id: "novel.reminder.todo_idle.acknowledgement",
    version: "1.0.0",
  });

const TODO_IDLE_TEXT = [
  "# 进行中的任务提醒",
  "仍有**进行中（in_progress）**的任务未完成：",
  "- 请优先推进进行中的任务，或调整其状态（完成/取消），避免任务长时间搁置。",
  "- 若需新增任务，用 TodoWrite 维护当前列表；完成后用 TodoWrite 标记完成。",
].join("\n");

export class TodoNudgePolicy implements RuntimePolicy {
  readonly id = "todo_idle";
  readonly phases = Object.freeze([RUNTIME_POLICY_PHASE.beforeProviderCall]);
  private readonly latches = new Map<string, TodoIdleLatch | undefined>();
  private readonly logger: Logger;

  constructor(options: { readonly logger?: Logger } = {}) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "todo_idle_nudge_policy",
    });
  }

  evaluate(
    context: RuntimePolicyContext,
    _state: RuntimePolicyState,
  ): readonly RuntimePolicyEffect[] {
    if (context.phase !== RUNTIME_POLICY_PHASE.beforeProviderCall) return [];
    const signals = context.runtimeSignals;
    if (signals === undefined) return [];
    const todos = signals.todos;
    if (todos === undefined) return [];

    const conversationId = context.conversationId;
    const providerCallCount = signals.providerCallCount;
    const previous = this.latches.get(conversationId);
    const effects: RuntimePolicyEffect[] = [];

    if (todos.inProgressCount > 0) {
      if (previous === undefined) {
        // 首个 in_progress provider call：记录 latch，不触发。
        this.latches.set(conversationId, {
          sinceProviderCall: providerCallCount,
          scheduled: false,
        });
        return Object.freeze([]);
      }
      if (!previous.scheduled) {
        if (
          providerCallCount - previous.sinceProviderCall + 1 >=
          TODO_IDLE_SUSTAINED_PROVIDER_CALLS
        ) {
          effects.push(
            createNudgeScheduleEffect({
              policyId: this.id,
              conversationId,
              runId: context.runId,
              nudgeId: TODO_IDLE_NUDGE_ID,
              effect: createTodoIdleNudgeEffect(context.runId),
              evaluatedAt: context.evaluatedAt,
            }),
          );
          this.latches.set(conversationId, {
            sinceProviderCall: previous.sinceProviderCall,
            scheduled: true,
          });
        }
      }
      return Object.freeze(effects);
    }

    // inProgressCount === 0 → 清 latch；若已 schedule 则 acknowledge 关闭。
    if (previous?.scheduled) {
      effects.push(
        createNudgeAcknowledgeEffect({
          policyId: this.id,
          conversationId,
          runId: context.runId,
          nudgeId: TODO_IDLE_NUDGE_ID,
          acknowledgementRef: TODO_IDLE_ACKNOWLEDGEMENT_REF,
          acknowledgedAt: context.evaluatedAt,
        }),
      );
    }
    this.latches.set(conversationId, undefined);
    this.logger.debug("todo.nudge.evaluated", {
      conversationId,
      inProgressCount: todos.inProgressCount,
      effectCount: effects.length,
    });
    return Object.freeze(effects);
  }
}

interface TodoIdleLatch {
  readonly sinceProviderCall: number;
  readonly scheduled: boolean;
}

function createTodoIdleNudgeEffect(runId: string): NudgeEffect {
  return Object.freeze({
    kind: "nudge",
    policyId: TODO_IDLE_POLICY_ID,
    templateId: TODO_IDLE_NUDGE_ID,
    templateVersion: TODO_IDLE_NUDGE_VERSION,
    reminderKind: "todo_idle",
    delivery: NUDGE_DELIVERY.untilAcknowledged,
    acknowledgementRef: TODO_IDLE_ACKNOWLEDGEMENT_REF,
    priority: TODO_IDLE_NUDGE_PRIORITY,
    dedupeKey: "todo_idle",
    targetRunId: runId,
    parameters: Object.freeze({}),
    cooldownTurns: TODO_IDLE_COOLDOWN_TURNS,
  });
}

export const todoIdleNudgeTemplate: NudgeTemplate = {
  templateId: TODO_IDLE_NUDGE_ID,
  templateVersion: TODO_IDLE_NUDGE_VERSION,
  render() {
    return TODO_IDLE_TEXT;
  },
};

export const todoIdleNudgeDefinition: NudgeDefinition = Object.freeze({
  id: TODO_IDLE_NUDGE_ID,
  version: TODO_IDLE_NUDGE_VERSION,
  requiredToolGroup: TODO_IDLE_TOOL_GROUP,
  createPolicy: () => new TodoNudgePolicy(),
  template: todoIdleNudgeTemplate,
});
