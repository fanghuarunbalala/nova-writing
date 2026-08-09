/**
 * compose_mode / compose_mode_exit 的集中定义：手写 Policy 类 + 模板同文件。
 *
 * transition 驱动（相对旧 nudge 的 schedule/cooldown/ack）：每次 provider call 对比
 * `runtimeSignals.compose` 与 latch `lastSeenActive`——false→true 发一条持久化
 * `compose_mode`，true→false 发一条 `compose_mode_exit`；无 transition 不动作。
 * latch 在 child 启动时由 `ComposeModeNudgePolicy.seed(conversationId, snapshot)` 用
 * 已 hydrate 的 compose 状态种子（跨进程重启后仍 compose 中 → 不重发 compose_mode）。
 * 持久化路径：effect → SystemReminderAttachedOutputEvent → canonical system.reminder。
 */
import * as path from "node:path";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { ComposeModeSnapshot } from "../../compose/ComposeModeState.js";
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
export const COMPOSE_MODE_EXIT_NUDGE_ID = "novel.reminder.compose_mode_exit";
export const COMPOSE_MODE_NUDGE_VERSION = "1.0.0";
/** 工具组守卫：必须 ∈ manifest tools.groupIds（compose 工具组）。 */
export const COMPOSE_MODE_TOOL_GROUP = "novel.compose";

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
      Object.freeze({ lastSeenActive: compose.active }),
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
    };
    const effects: RuntimePolicyEffect[] = [];

    if (compose.active && !previous.lastSeenActive) {
      // 进入 compose（false→true）→ 附加 compose_mode（持久化）。
      effects.push(
        createSystemReminderAttachEffect({
          policyId: this.id,
          conversationId,
          runId: context.runId,
          reminderId: COMPOSE_MODE_NUDGE_ID,
          reminderKind: "compose_mode",
          templateId: COMPOSE_MODE_NUDGE_ID,
          templateVersion: COMPOSE_MODE_NUDGE_VERSION,
          parameters: Object.freeze({
            phase: compose.phase,
            ...(compose.designFilePath === undefined
              ? {}
              : {
                  // 给 agent 的路径一律 workspace 相对（绝对路径会被 FileToolService 拒绝）。
                  // Paths shown to the agent are workspace-relative (absolute paths are rejected).
                  designFilePath: designFileWorkspaceRelativePath(
                    compose.designFilePath,
                  ),
                }),
          }),
        }),
      );
    } else if (!compose.active && previous.lastSeenActive) {
      // 退出 compose（true→false，approve/discard）→ 附加一次性 compose_mode_exit。
      effects.push(
        createSystemReminderAttachEffect({
          policyId: this.id,
          conversationId,
          runId: context.runId,
          reminderId: COMPOSE_MODE_EXIT_NUDGE_ID,
          reminderKind: "compose_mode_exit",
          templateId: COMPOSE_MODE_EXIT_NUDGE_ID,
          templateVersion: COMPOSE_MODE_NUDGE_VERSION,
          parameters: Object.freeze({}),
        }),
      );
    }

    const next = Object.freeze({ lastSeenActive: compose.active });
    this.latches.set(conversationId, next);
    this.logger.debug("compose.reminder.evaluated", {
      conversationId,
      composeActive: compose.active,
      composePhase: compose.phase,
      effectCount: effects.length,
    });
    return Object.freeze(effects);
  }
}

interface ComposeModeLatch {
  readonly lastSeenActive: boolean;
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
