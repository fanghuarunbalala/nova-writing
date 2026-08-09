/**
 * compose_mode / compose_mode_exit 的集中定义：手写 Policy 类 + 模板同文件。
 *
 * 对齐 CCB plan mode 的 system-reminder 注入：进入时 schedule（首条 full），
 * 进行中按 cooldown 由 nudge 选择器重交付（交付后抑制 4 条、第 5 条重交付 →
 * 每 ≥5 条 provider call 一条），且 deliveryCount 驱动 full/sparse 交替
 * （第 1/6/11… 次交付 full）；退出时 acknowledge compose_mode +
 * schedule 一次性 compose_mode_exit。
 */
import * as path from "node:path";
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

/** RuntimePolicy.id；两 nudge 同属此 policy（引擎断言 effect.policyId === policy.id）。 */
export const COMPOSE_MODE_POLICY_ID = "compose_mode";

export const COMPOSE_MODE_NUDGE_ID = "novel.reminder.compose_mode";
export const COMPOSE_MODE_EXIT_NUDGE_ID = "novel.reminder.compose_mode_exit";
export const COMPOSE_MODE_NUDGE_VERSION = "1.0.0";
/** 工具组守卫：必须 ∈ manifest tools.groupIds（compose 工具组）。 */
export const COMPOSE_MODE_TOOL_GROUP = "novel.compose";
/**
 * 进行中重交付的 cooldown（provider call 单位）。
 * 选择器为 strict > 语义：交付后抑制 N 条、第 N+1 条重交付（见 NudgeSelector）。
 * 故取 4 → 首条 #1 交付后，#6/#11/#16/#21/#26… 每 ~5 条 provider call 一条；
 * full 落在第 1/6 次交付（#1/#26），符合"第 1/6/11… 次交付 full"。
 */
export const COMPOSE_MODE_COOLDOWN_TURNS = 4;
/** 每第 N 次交付为 full（1/6/11… 为 full，其余 sparse）。 */
export const COMPOSE_MODE_FULL_REMINDER_EVERY_N_REMINDERS = 5;
export const COMPOSE_MODE_NUDGE_PRIORITY = 20;
export const COMPOSE_MODE_EXIT_NUDGE_PRIORITY = 10;
export const COMPOSE_MODE_ACKNOWLEDGEMENT_REF: NudgeAcknowledgementReference =
  Object.freeze({
    id: "novel.reminder.compose_mode.acknowledgement",
    version: "1.0.0",
  });

const COMPOSE_MODE_SPARSE_TEXT =
  "仍在设计模式：正式稿只读；请用 workspace 相对路径在 `.novel/design/` 维护草稿，完成后调用 **ExitComposeMode** 提交审批。";

const COMPOSE_MODE_EXIT_TEXT = [
  "# 设计模式已结束",
  "正式稿写入已恢复。请按审批结果继续创作：",
  "- 若已批准：按草稿内容将正文写入正式稿（canonical 写入工具已恢复）。",
  "- 若已放弃：草稿文件保留在会话设计目录中，可随时重新进入设计模式。",
].join("\n");

export class ComposeModeNudgePolicy implements RuntimePolicy {
  readonly id = "compose_mode";
  readonly phases = Object.freeze([RUNTIME_POLICY_PHASE.beforeProviderCall]);
  private readonly latches = new Map<string, ComposeModeLatch>();
  private readonly logger: Logger;

  constructor(options: { readonly logger?: Logger } = {}) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "compose_mode_nudge_policy",
    });
  }

  evaluate(
    context: RuntimePolicyContext,
    _state: RuntimePolicyState,
  ): readonly RuntimePolicyEffect[] {
    if (context.phase !== RUNTIME_POLICY_PHASE.beforeProviderCall) return [];
    const compose = context.runtimeSignals?.compose;
    if (compose === undefined) return [];

    const conversationId = context.conversationId;
    const previous =
      this.latches.get(conversationId) ??
      Object.freeze({ active: false, composeScheduled: false });
    const effects: RuntimePolicyEffect[] = [];
    let next: ComposeModeLatch;

    if (compose.active && !previous.composeScheduled) {
      // 进入 compose → schedule compose_mode（首条交付 full）。
      effects.push(
        createNudgeScheduleEffect({
          policyId: this.id,
          conversationId,
          runId: context.runId,
          nudgeId: COMPOSE_MODE_NUDGE_ID,
          effect: createComposeModeNudgeEffect(context.runId, compose),
          evaluatedAt: context.evaluatedAt,
        }),
      );
      next = Object.freeze({ active: true, composeScheduled: true });
    } else if (!compose.active && previous.active) {
      // 退出 compose（approve/discard）→ 关闭 compose_mode + 一次性 exit。
      if (previous.composeScheduled) {
        effects.push(
          createNudgeAcknowledgeEffect({
            policyId: this.id,
            conversationId,
            runId: context.runId,
            nudgeId: COMPOSE_MODE_NUDGE_ID,
            acknowledgementRef: COMPOSE_MODE_ACKNOWLEDGEMENT_REF,
            acknowledgedAt: context.evaluatedAt,
          }),
        );
      }
      effects.push(
        createNudgeScheduleEffect({
          policyId: this.id,
          conversationId,
          runId: context.runId,
          nudgeId: COMPOSE_MODE_EXIT_NUDGE_ID,
          effect: createComposeModeExitNudgeEffect(context.runId),
          evaluatedAt: context.evaluatedAt,
        }),
      );
      next = Object.freeze({ active: false, composeScheduled: false });
    } else {
      next = Object.freeze({
        active: compose.active,
        composeScheduled: previous.composeScheduled,
      });
    }

    this.latches.set(conversationId, next);
    this.logger.debug("compose.nudge.evaluated", {
      conversationId,
      composeActive: compose.active,
      composePhase: compose.phase,
      effectCount: effects.length,
    });
    return Object.freeze(effects);
  }
}

interface ComposeModeLatch {
  readonly active: boolean;
  readonly composeScheduled: boolean;
}

function createComposeModeNudgeEffect(
  runId: string,
  compose: {
    readonly phase: string;
    readonly designFilePath?: string;
  },
): NudgeEffect {
  return Object.freeze({
    kind: "nudge",
    policyId: COMPOSE_MODE_POLICY_ID,
    templateId: COMPOSE_MODE_NUDGE_ID,
    templateVersion: COMPOSE_MODE_NUDGE_VERSION,
    reminderKind: "compose_mode",
    delivery: NUDGE_DELIVERY.untilAcknowledged,
    acknowledgementRef: COMPOSE_MODE_ACKNOWLEDGEMENT_REF,
    priority: COMPOSE_MODE_NUDGE_PRIORITY,
    dedupeKey: "compose_mode",
    targetRunId: runId,
    parameters: Object.freeze({
      phase: compose.phase,
      ...(compose.designFilePath === undefined
        ? {}
        : {
            // 给 agent 的路径一律 workspace 相对（绝对路径会被 FileToolService 拒绝）。
            // Paths shown to the agent are workspace-relative (absolute paths are rejected).
            designFilePath: designFileWorkspaceRelativePath(compose.designFilePath),
          }),
    }),
    cooldownTurns: COMPOSE_MODE_COOLDOWN_TURNS,
    exclusive: true,
  });
}

function createComposeModeExitNudgeEffect(runId: string): NudgeEffect {
  return Object.freeze({
    kind: "nudge",
    policyId: COMPOSE_MODE_POLICY_ID,
    templateId: COMPOSE_MODE_EXIT_NUDGE_ID,
    templateVersion: COMPOSE_MODE_NUDGE_VERSION,
    reminderKind: "compose_mode_exit",
    delivery: NUDGE_DELIVERY.once,
    priority: COMPOSE_MODE_EXIT_NUDGE_PRIORITY,
    dedupeKey: "compose_mode_exit",
    targetRunId: runId,
    parameters: Object.freeze({}),
    exclusive: true,
  });
}

export const composeModeNudgeTemplate: NudgeTemplate = {
  templateId: COMPOSE_MODE_NUDGE_ID,
  templateVersion: COMPOSE_MODE_NUDGE_VERSION,
  render(parameters) {
    const deliveryCount =
      typeof parameters.deliveryCount === "number"
        ? parameters.deliveryCount
        : 1;
    const isFull =
      deliveryCount % COMPOSE_MODE_FULL_REMINDER_EVERY_N_REMINDERS === 1;
    if (!isFull) return COMPOSE_MODE_SPARSE_TEXT;
    const designFilePath =
      typeof parameters.designFilePath === "string"
        ? parameters.designFilePath
        : undefined;
    return renderComposeModeFullText(designFilePath);
  },
};

export const composeModeExitNudgeTemplate: NudgeTemplate = {
  templateId: COMPOSE_MODE_EXIT_NUDGE_ID,
  templateVersion: COMPOSE_MODE_NUDGE_VERSION,
  render() {
    return renderComposeModeExitText();
  },
};

/** ExitComposeMode tool_result 与模板共用的退出回显文案。 */
export function renderComposeModeExitText(): string {
  return COMPOSE_MODE_EXIT_TEXT;
}

export const composeModeNudgeDefinition: NudgeDefinition = Object.freeze({
  id: COMPOSE_MODE_NUDGE_ID,
  version: COMPOSE_MODE_NUDGE_VERSION,
  requiredToolGroup: COMPOSE_MODE_TOOL_GROUP,
  createPolicy: () => new ComposeModeNudgePolicy(),
  template: composeModeNudgeTemplate,
});

export const composeModeExitNudgeDefinition: NudgeDefinition = Object.freeze({
  id: COMPOSE_MODE_EXIT_NUDGE_ID,
  version: COMPOSE_MODE_NUDGE_VERSION,
  requiredToolGroup: COMPOSE_MODE_TOOL_GROUP,
  createPolicy: () => new ComposeModeNudgePolicy(),
  template: composeModeExitNudgeTemplate,
});

/** 绝对 design 文件路径 → workspace 相对路径（`.novel/design/<id>.md`，正斜杠）。 */
/** Absolute design file path -> workspace-relative (`.novel/design/<id>.md`, forward slashes). */
export function designFileWorkspaceRelativePath(designFilePath: string): string {
  return path.join(".novel", "design", path.basename(designFilePath)).split(path.sep).join("/");
}

/** EnterComposeMode tool_result 与模板共用的约束全文。 */
export function renderComposeModeFullText(designFilePath?: string): string {
  return [
    "# 设计模式（Compose Mode）",
    "当前处于**设计模式**：",
    "- 正式稿只读：canonical 写入工具会被拒绝；文件工具（Read/Glob/Write/Edit）全模式可用，路径一律用 **workspace 相对路径**（越出 workspace 沙盒会报错），草稿请维护在 `.novel/design/` 设计目录。",
    "- 逐步写出你要创作的内容（大纲或正文），用 Write/Edit 增量完善草稿。",
    "- 草稿完成后调用 **ExitComposeMode** 提交审批；**不要用文本询问审批**。",
    "- 如果作者拒绝了草稿：按反馈修订草稿文件后重新提交，**不要原样重试**。",
    ...(designFilePath === undefined
      ? []
      : [`- 当前会话设计文件：\`${designFilePath}\``]),
  ].join("\n");
}
