/**
 * todo_idle 的集中定义：手写 Policy 类 + 模板同文件。
 *
 * 触发单位是 provider call（turn），不是 run（用户消息）：
 * 本对话曾写过 todo（有 snapshot）且「连续 ≥TODO_IDLE_SUSTAINED_CALLS 次 provider call
 * 未调用 TodoWrite」→ 每 run 注入一次；每个新 run（用户消息）计数清空（跨轮清空累计）；
 * TodoWrite 调用即清空计数（写后重新计数，写后 TODO_IDLE_SUSTAINED_CALLS 个未写 call 仍触发）。
 * 计数在 policy 实例内 per-conversation latch 里跨 run 存活（child 进程内跨 run 共享；
 * 跨进程重启由 todo journal 重放恢复 lastUpdatedRunId，计数进程内分段、不跨进程续计）。
 * 交付：持久化 `system_reminder_attach(kind: todo_idle)`——每 run 至多一条，latch
 * `scheduledRunId` 守卫（下一 run 的 runId 不同自然重新触发）。
 */
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  RUNTIME_POLICY_PHASE,
  type RuntimePolicy,
  type RuntimePolicyContext,
  type RuntimePolicyEffect,
  type RuntimePolicyState,
} from "../../policy/index.js";
import type { NudgeTemplate } from "../NudgeTemplateRegistry.js";
import type { NudgeDefinition } from "./NudgeDefinition.js";
import { createSystemReminderAttachEffect } from "./effectBuilders.js";

/** RuntimePolicy.id；引擎断言 effect.policyId === policy.id。 */
const TODO_IDLE_POLICY_ID = "todo_idle";

export const TODO_IDLE_NUDGE_ID = "novel.reminder.todo_idle";
export const TODO_IDLE_NUDGE_VERSION = "1.0.0";
/** 工具组守卫：必须 ∈ manifest tools.groupIds（runtime.todo 工具组）。 */
export const TODO_IDLE_TOOL_GROUP = "runtime.todo";
/** 连续多少次 provider call（turn）未调用 TodoWrite 后才提醒。 */
export const TODO_IDLE_SUSTAINED_CALLS = 3;
/** 模板里的稳定断言标记（smoke 用；改动模板时须同步）。 */
export const TODO_IDLE_MARK = "待办列表维护提醒";

const TODO_IDLE_TEXT = [
  `# ${TODO_IDLE_MARK}`,
  "已有多轮未调用 TodoWrite 维护任务列表，请检查当前待办是否仍有效：",
  "- 用 TodoWrite 更新列表（新增 / 标记完成 / 取消），保持任务与当前工作一致。",
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

    const conversationId = context.conversationId;
    const previous = this.latches.get(conversationId) ?? {
      callsSinceTodoWrite: 0,
      hadWriteThisRun: false,
    };
    let latch = previous;

    // 1. 跨轮清空：新 run（用户消息）→ 计数归零、本 run 尚未观察到写。
    if (previous.lastSeenRunId !== context.runId) {
      latch = {
        lastSeenRunId: context.runId,
        callsSinceTodoWrite: 0,
        hadWriteThisRun: false,
        scheduledRunId: previous.scheduledRunId,
      };
    }

    // 2. 本 run 首次观察到 TodoWrite（本 run 上一 provider call 写入，lastUpdatedRunId
    //    === runId）→ 计数归零（写即清空，写后重新计数）。hadWriteThisRun 防止同 run
    //    后续 call 反复清零导致计数永不达阈值；lastUpdatedRunId 是 per-run 粒度，无法
    //    区分同 run 内第二次写入（信号固有局限，可接受）。
    if (
      todos !== undefined &&
      todos.lastUpdatedRunId === context.runId &&
      !latch.hadWriteThisRun
    ) {
      latch = { ...latch, callsSinceTodoWrite: 0, hadWriteThisRun: true };
    }

    // 3. 本 provider call 计入。
    latch = { ...latch, callsSinceTodoWrite: latch.callsSinceTodoWrite + 1 };
    this.latches.set(conversationId, latch);

    // 4. attach 条件：有 snapshot、计数达阈值、且本 run 尚未 attach 过（每 run 至多一次）。
    const effects: RuntimePolicyEffect[] = [];
    if (
      todos !== undefined &&
      latch.callsSinceTodoWrite >= TODO_IDLE_SUSTAINED_CALLS &&
      latch.scheduledRunId !== context.runId
    ) {
      effects.push(
        createSystemReminderAttachEffect({
          policyId: this.id,
          conversationId,
          runId: context.runId,
          reminderId: TODO_IDLE_NUDGE_ID,
          reminderKind: "todo_idle",
          templateId: TODO_IDLE_NUDGE_ID,
          templateVersion: TODO_IDLE_NUDGE_VERSION,
          parameters: Object.freeze({}),
        }),
      );
      latch = { ...latch, scheduledRunId: context.runId };
      this.latches.set(conversationId, latch);
      this.logger.debug("todo.reminder.attached", {
        conversationId,
        callsSinceTodoWrite: latch.callsSinceTodoWrite,
      });
    }
    // scheduledRunId 不主动清：仅作 per-run 守卫，下一 run 的 runId 不同自然重新触发。
    return Object.freeze(effects);
  }
}

interface TodoIdleLatch {
  readonly lastSeenRunId?: string;
  /** 距上一次 TodoWrite（或本 run 起始）的 provider call 数。 */
  readonly callsSinceTodoWrite: number;
  /** 本 run 是否已观察到一次 TodoWrite；写清空每 run 只触发一次。 */
  readonly hadWriteThisRun: boolean;
  readonly scheduledRunId?: string;
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
