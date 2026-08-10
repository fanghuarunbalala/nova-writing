/**
 * compose 系列提醒的集中定义：手写 Policy 类 + 模板同文件。
 *
 * 触发单位是 provider call（turn）。状态由 runtimeSignals.compose（ComposeModeSnapshot）
 * 驱动，按 transition 附加对应提醒：
 * - false→true（进入）：附加持久化 compose_mode（full 5-phase 工作流）；若
 *   hasPriorDraft 则再附加持久化 compose_mode_reentry（已有旧草稿 → 继续/覆盖决策）。
 * - true→false（批准/放弃退出）：附加持久化 compose_mode_exit。
 * - designing→pending（ExitComposeMode 提交）：附加持久化 compose_mode_pending。
 * - 无 transition 且仍 compose：跨 run 每 COMPOSE_MODE_SPARSE_EVERY_CALLS 次 provider
 *   call 附加一次瞬态 compose_mode_sparse（仅同 run overlay，不入 canonical）。
 * 持久化路径：effect → SystemReminderAttachedOutputEvent → canonical system.reminder。
 * 瞬态路径：effect(transient) → 仅同 run overlay（runReminders）。
 */
import * as path from "node:path";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type {
  ComposeModePhase,
  ComposeModeSnapshot,
} from "../../compose/ComposeModeState.js";
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
export const COMPOSE_MODE_POLICY_ID = "compose_mode";

export const COMPOSE_MODE_NUDGE_ID = "novel.reminder.compose_mode";
export const COMPOSE_MODE_PENDING_NUDGE_ID = "novel.reminder.compose_mode_pending";
export const COMPOSE_MODE_REENTRY_NUDGE_ID = "novel.reminder.compose_mode_reentry";
export const COMPOSE_MODE_EXIT_NUDGE_ID = "novel.reminder.compose_mode_exit";
export const COMPOSE_MODE_SPARSE_NUDGE_ID = "novel.reminder.compose_mode_sparse";
export const COMPOSE_MODE_NUDGE_VERSION = "1.0.0";
/** 工具组守卫：必须 ∈ manifest tools.groupIds（compose 工具组）。 */
export const COMPOSE_MODE_TOOL_GROUP = "novel.compose";
/** 仍 compose 且无新 transition 时，跨 run 每多少次 provider call 附加一次 sparse 刷新。 */
/** Sparse refresh cadence while compose stays active without a new transition. */
export const COMPOSE_MODE_SPARSE_EVERY_CALLS = 5;

const COMPOSE_MODE_EXIT_TEXT = [
  "# 设计模式已结束",
  "正式稿写入已恢复。请按审批结果继续创作：",
  "- 若已批准：按草稿内容将正文写入正式稿（canonical 写入工具已恢复）。",
  "- 若已放弃：草稿文件保留在会话设计目录中，可随时重新进入设计模式。",
].join("\n");

const COMPOSE_MODE_PENDING_TEXT = [
  "# 设计模式：等待审批",
  "草稿已提交审批，等待作者确认。在作者批准或拒绝前，不要继续修改草稿。",
].join("\n");

const COMPOSE_MODE_REENTRY_TEXT = [
  "# 设计模式：已有旧草稿",
  "检测到本会话存在上次的设计草稿。开始创作前：",
  "1. 先读取旧草稿，了解之前规划的内容。",
  "2. 对照当前需求评估：",
  "   - **不同需求**：覆盖旧草稿，从头开始。",
  "   - **延续需求**：在旧草稿基础上增量修改，清理过时部分。",
  "3. 然后按设计模式创作流程继续。",
].join("\n");

const COMPOSE_MODE_SPARSE_TEXT = [
  "# 设计模式（刷新）",
  "设计模式仍激活：正式稿只读、草稿维护在 `.novel/design/`、完成后用 **ExitComposeMode** 提交审批。完整流程见前文。",
].join("\n");

export class ComposeModeNudgePolicy implements RuntimePolicy {
  readonly id = COMPOSE_MODE_POLICY_ID;
  readonly phases = Object.freeze([RUNTIME_POLICY_PHASE.beforeProviderCall]);
  private readonly latches = new Map<string, ComposeModeLatch>();
  private readonly logger: Logger;

  constructor(options: { readonly logger?: Logger } = {}) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "compose_mode_nudge_policy",
    });
  }

  /**
   * child 启动种子：用已 hydrate 的 compose 状态初始化每对话 latch，避免跨进程重启
   * 后把「已在 compose 中」误判为上升沿而重发 compose_mode。若 latch 已存在不覆盖。
   * Seeds the per-conversation latch with the hydrated compose state at child startup,
   * so an already-active compose is not mistaken for a rising edge after restart.
   */
  seed(conversationId: string, compose: ComposeModeSnapshot): void {
    if (this.latches.has(conversationId)) return;
    this.latches.set(
      conversationId,
      Object.freeze({
        lastSeenActive: compose.active,
        lastSeenPhase: compose.phase,
        callsSinceReminder: 0,
      }),
    );
  }

  evaluate(
    context: RuntimePolicyContext,
    _state: RuntimePolicyState,
  ): readonly RuntimePolicyEffect[] {
    if (context.phase !== RUNTIME_POLICY_PHASE.beforeProviderCall) return [];
    const compose = context.runtimeSignals?.compose;
    if (compose === undefined) return [];

    const conversationId = context.conversationId;
    const previous = this.latches.get(conversationId) ?? {
      lastSeenActive: compose.active,
      lastSeenPhase: compose.phase,
      callsSinceReminder: 0,
    };
    const effects: RuntimePolicyEffect[] = [];
    let callsSinceReminder = previous.callsSinceReminder;
    let lastSparseRunId = previous.lastSparseRunId;

    if (compose.active && !previous.lastSeenActive) {
      // 进入 compose（false→true）→ 附加 full compose_mode（持久化）；有旧草稿再附 reentry。
      effects.push(this.composeModeEffect(context, compose.designFilePath));
      if (compose.hasPriorDraft === true) {
        effects.push(this.reentryEffect(context));
      }
      callsSinceReminder = 0;
      lastSparseRunId = context.runId;
    } else if (!compose.active && previous.lastSeenActive) {
      // 退出 compose（true→false，approve/discard）→ 附加一次性 compose_mode_exit。
      effects.push(this.exitEffect(context));
      callsSinceReminder = 0;
      lastSparseRunId = context.runId;
    } else if (
      compose.active &&
      compose.phase === "pending" &&
      previous.lastSeenPhase !== "pending"
    ) {
      // 提交审批（designing→pending）→ 附加一次性 compose_mode_pending。
      effects.push(this.pendingEffect(context));
      callsSinceReminder = 0;
      lastSparseRunId = context.runId;
    } else {
      // 无 transition：累积 provider call 计数，跨 run 每 N 次附加一次瞬态 sparse 刷新。
      callsSinceReminder += 1;
      if (
        compose.active &&
        callsSinceReminder >= COMPOSE_MODE_SPARSE_EVERY_CALLS &&
        lastSparseRunId !== context.runId
      ) {
        effects.push(this.sparseEffect(context));
        lastSparseRunId = context.runId;
        callsSinceReminder = 0;
      }
    }

    const next: ComposeModeLatch = Object.freeze({
      lastSeenActive: compose.active,
      lastSeenPhase: compose.phase,
      callsSinceReminder,
      ...(lastSparseRunId === undefined ? {} : { lastSparseRunId }),
    });
    this.latches.set(conversationId, next);
    this.logger.debug("compose.reminder.evaluated", {
      conversationId,
      composeActive: compose.active,
      composePhase: compose.phase,
      effectCount: effects.length,
    });
    return Object.freeze(effects);
  }

  private composeModeEffect(
    context: RuntimePolicyContext,
    designFilePath: string | undefined,
  ): RuntimePolicyEffect {
    return createSystemReminderAttachEffect({
      policyId: this.id,
      conversationId: context.conversationId,
      runId: context.runId,
      reminderId: COMPOSE_MODE_NUDGE_ID,
      reminderKind: "compose_mode",
      templateId: COMPOSE_MODE_NUDGE_ID,
      templateVersion: COMPOSE_MODE_NUDGE_VERSION,
      parameters: Object.freeze({
        phase: context.runtimeSignals?.compose?.phase ?? "designing",
        ...(designFilePath === undefined
          ? {}
          : {
              // 给 agent 的路径一律 workspace 相对（绝对路径会被 FileToolService 拒绝）。
              // Paths shown to the agent are workspace-relative (absolute paths are rejected).
              designFilePath: designFileWorkspaceRelativePath(designFilePath),
            }),
      }),
    });
  }

  private pendingEffect(context: RuntimePolicyContext): RuntimePolicyEffect {
    return createSystemReminderAttachEffect({
      policyId: this.id,
      conversationId: context.conversationId,
      runId: context.runId,
      reminderId: COMPOSE_MODE_PENDING_NUDGE_ID,
      reminderKind: "compose_mode_pending",
      templateId: COMPOSE_MODE_PENDING_NUDGE_ID,
      templateVersion: COMPOSE_MODE_NUDGE_VERSION,
      parameters: Object.freeze({}),
    });
  }

  private reentryEffect(context: RuntimePolicyContext): RuntimePolicyEffect {
    return createSystemReminderAttachEffect({
      policyId: this.id,
      conversationId: context.conversationId,
      runId: context.runId,
      reminderId: COMPOSE_MODE_REENTRY_NUDGE_ID,
      reminderKind: "compose_mode_reentry",
      templateId: COMPOSE_MODE_REENTRY_NUDGE_ID,
      templateVersion: COMPOSE_MODE_NUDGE_VERSION,
      parameters: Object.freeze({}),
    });
  }

  private exitEffect(context: RuntimePolicyContext): RuntimePolicyEffect {
    return createSystemReminderAttachEffect({
      policyId: this.id,
      conversationId: context.conversationId,
      runId: context.runId,
      reminderId: COMPOSE_MODE_EXIT_NUDGE_ID,
      reminderKind: "compose_mode_exit",
      templateId: COMPOSE_MODE_EXIT_NUDGE_ID,
      templateVersion: COMPOSE_MODE_NUDGE_VERSION,
      parameters: Object.freeze({}),
    });
  }

  private sparseEffect(context: RuntimePolicyContext): RuntimePolicyEffect {
    return createSystemReminderAttachEffect({
      policyId: this.id,
      conversationId: context.conversationId,
      runId: context.runId,
      reminderId: COMPOSE_MODE_SPARSE_NUDGE_ID,
      reminderKind: "compose_mode_sparse",
      templateId: COMPOSE_MODE_SPARSE_NUDGE_ID,
      templateVersion: COMPOSE_MODE_NUDGE_VERSION,
      parameters: Object.freeze({}),
      transient: true,
    });
  }
}

interface ComposeModeLatch {
  readonly lastSeenActive: boolean;
  readonly lastSeenPhase: ComposeModePhase;
  /** 距上一次 attach 的 provider call 数（sparse 刷新节奏）。 */
  readonly callsSinceReminder: number;
  /** 已发 sparse 的 runId（每 run 至多一次守卫）。 */
  readonly lastSparseRunId?: string;
}

export const composeModeNudgeTemplate: NudgeTemplate = {
  templateId: COMPOSE_MODE_NUDGE_ID,
  templateVersion: COMPOSE_MODE_NUDGE_VERSION,
  render(parameters) {
    const designFilePath =
      typeof parameters.designFilePath === "string"
        ? parameters.designFilePath
        : undefined;
    return renderComposeModeFullText(designFilePath);
  },
};

export const composeModePendingNudgeTemplate: NudgeTemplate = {
  templateId: COMPOSE_MODE_PENDING_NUDGE_ID,
  templateVersion: COMPOSE_MODE_NUDGE_VERSION,
  render() {
    return renderComposeModePendingText();
  },
};

export const composeModeReentryNudgeTemplate: NudgeTemplate = {
  templateId: COMPOSE_MODE_REENTRY_NUDGE_ID,
  templateVersion: COMPOSE_MODE_NUDGE_VERSION,
  render() {
    return renderComposeModeReentryText();
  },
};

export const composeModeExitNudgeTemplate: NudgeTemplate = {
  templateId: COMPOSE_MODE_EXIT_NUDGE_ID,
  templateVersion: COMPOSE_MODE_NUDGE_VERSION,
  render() {
    return renderComposeModeExitText();
  },
};

export const composeModeSparseNudgeTemplate: NudgeTemplate = {
  templateId: COMPOSE_MODE_SPARSE_NUDGE_ID,
  templateVersion: COMPOSE_MODE_NUDGE_VERSION,
  render() {
    return renderComposeModeSparseText();
  },
};

/** 进入 compose 时附加的 full 5-phase 创作工作流全文。 */
/** Full 5-phase creation workflow attached on entering compose. */
export function renderComposeModeFullText(designFilePath?: string): string {
  return [
    "# 设计模式（Compose Mode）",
    "当前处于**设计模式**，以下约束优先于其他任何指令：",
    "- 正式稿只读：canonical 写入工具会被拒绝；文件工具（Read/Glob/Write/Edit）全模式可用，路径一律用 **workspace 相对路径**（越出 workspace 沙盒会报错）。",
    "- 草稿维护在 `.novel/design/` 设计目录。",
    ...(designFilePath === undefined
      ? []
      : [`- 当前会话设计文件：\`${designFilePath}\``]),
    "",
    "## 创作工作流",
    "按以下阶段推进创作：",
    "",
    "### Phase 1: 理解需求",
    "聚焦给定的创作需求，阅读相关既有设定（大纲/人物/地点），理解当前故事结构与约束。",
    "",
    "### Phase 2: 探索",
    "建议派 **novel_explore** 子代理并行查设定、时间线、伏笔、矛盾点；复杂任务必派，琐碎任务可直接用只读工具自行探索。",
    "",
    "### Phase 3: 创作草案",
    "建议派 **novel_compose** 子代理设计大纲或正文草案；复杂草稿必派，琐碎草稿可自行创作。",
    "",
    "### Phase 4: 综合写入草稿",
    "评审子代理产出，用 Write/Edit 增量完善 design 文件（唯一可写文件）。",
    "",
    "### Phase 5: 提交审批",
    "草稿完成后调用 **ExitComposeMode** 提交审批；不得用文本询问审批；若被拒：按反馈修订后重新提交，不要原样重试。",
  ].join("\n");
}

/** ExitComposeMode tool_result 与模板共用的退出回显文案。 */
export function renderComposeModeExitText(): string {
  return COMPOSE_MODE_EXIT_TEXT;
}

/** compose_mode_pending 模板与关联回显共用的等待审批文案。 */
export function renderComposeModePendingText(): string {
  return COMPOSE_MODE_PENDING_TEXT;
}

/** compose_mode_reentry 模板的已有旧草稿决策文案。 */
export function renderComposeModeReentryText(): string {
  return COMPOSE_MODE_REENTRY_TEXT;
}

/** compose_mode_sparse 模板的瞬态刷新文案。 */
export function renderComposeModeSparseText(): string {
  return COMPOSE_MODE_SPARSE_TEXT;
}

export const composeModeNudgeDefinition: NudgeDefinition = Object.freeze({
  id: COMPOSE_MODE_NUDGE_ID,
  version: COMPOSE_MODE_NUDGE_VERSION,
  requiredToolGroup: COMPOSE_MODE_TOOL_GROUP,
  createPolicy: () => new ComposeModeNudgePolicy(),
  template: composeModeNudgeTemplate,
});

export const composeModePendingNudgeDefinition: NudgeDefinition = Object.freeze({
  id: COMPOSE_MODE_PENDING_NUDGE_ID,
  version: COMPOSE_MODE_NUDGE_VERSION,
  requiredToolGroup: COMPOSE_MODE_TOOL_GROUP,
  createPolicy: () => new ComposeModeNudgePolicy(),
  template: composeModePendingNudgeTemplate,
});

export const composeModeReentryNudgeDefinition: NudgeDefinition = Object.freeze({
  id: COMPOSE_MODE_REENTRY_NUDGE_ID,
  version: COMPOSE_MODE_NUDGE_VERSION,
  requiredToolGroup: COMPOSE_MODE_TOOL_GROUP,
  createPolicy: () => new ComposeModeNudgePolicy(),
  template: composeModeReentryNudgeTemplate,
});

export const composeModeExitNudgeDefinition: NudgeDefinition = Object.freeze({
  id: COMPOSE_MODE_EXIT_NUDGE_ID,
  version: COMPOSE_MODE_NUDGE_VERSION,
  requiredToolGroup: COMPOSE_MODE_TOOL_GROUP,
  createPolicy: () => new ComposeModeNudgePolicy(),
  template: composeModeExitNudgeTemplate,
});

export const composeModeSparseNudgeDefinition: NudgeDefinition = Object.freeze({
  id: COMPOSE_MODE_SPARSE_NUDGE_ID,
  version: COMPOSE_MODE_NUDGE_VERSION,
  requiredToolGroup: COMPOSE_MODE_TOOL_GROUP,
  createPolicy: () => new ComposeModeNudgePolicy(),
  template: composeModeSparseNudgeTemplate,
});

/** 绝对 design 文件路径 → workspace 相对路径（`.novel/design/<id>.md`，正斜杠）。 */
/** Absolute design file path -> workspace-relative (`.novel/design/<id>.md`, forward slashes). */
export function designFileWorkspaceRelativePath(designFilePath: string): string {
  return path.join(".novel", "design", path.basename(designFilePath)).split(path.sep).join("/");
}
