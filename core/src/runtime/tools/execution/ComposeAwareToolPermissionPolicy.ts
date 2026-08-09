/**
 * Compose 感知的权限包装策略：compose 激活时拒绝 canonical 写入，否则透传基础策略
 * （含 bypass 直接执行模式）。文件工具（Read/Glob/Write/Edit）**全模式可用**，不再
 * 按 compose 状态门控——作用域由 FileToolService 以 workspace 沙盒强制（越界 pathForbidden）。
 * Compose-aware permission wrapper: while compose is active it denies canonical writes;
 * otherwise it passes through to the base policy (including bypass mode). File tools are
 * available in all modes; scope is enforced by FileToolService via the workspace sandbox.
 */
import { ComposeModeStateProvider } from "../../compose/index.js";
import type {
  ToolPermissionDecision,
} from "./ToolExecutionContracts.js";
import type {
  ToolPermissionEvaluation,
  ToolPermissionPolicy,
} from "./ToolPermissionPolicy.js";

/** canonical 写工具（12 写 + 删除 + 旧 draft 写）。Canonical write tools. */
const CANONICAL_NOVEL_WRITES: ReadonlySet<string> = new Set([
  "NovelOutlineWrite",
  "NovelOutlineEdit",
  "NovelCharacterWrite",
  "NovelCharacterEdit",
  "NovelLocationWrite",
  "NovelLocationEdit",
  "NovelParagraphWrite",
  "NovelParagraphEdit",
  "NovelVolumeWrite",
  "NovelVolumeEdit",
  "NovelChapterWrite",
  "NovelChapterEdit",
  "NovelDelete",
]);

function deny(ruleId: string): ToolPermissionDecision {
  return Object.freeze({
    effect: "deny",
    ruleIds: Object.freeze([ruleId]),
    hardRestriction: false,
  });
}

function allow(ruleId: string): ToolPermissionDecision {
  return Object.freeze({
    effect: "allow",
    ruleIds: Object.freeze([ruleId]),
    hardRestriction: false,
  });
}

/** 包装基础权限策略的 compose 感知实现。Compose-aware wrapper over a base permission policy. */
export class ComposeAwareToolPermissionPolicy implements ToolPermissionPolicy {
  readonly #base: ToolPermissionPolicy;
  readonly #state: ComposeModeStateProvider;

  constructor(base: ToolPermissionPolicy, state: ComposeModeStateProvider) {
    this.#base = base;
    this.#state = state;
  }

  evaluate(evaluation: ToolPermissionEvaluation): ToolPermissionDecision {
    const snapshot = this.#state.snapshot(evaluation.invocation.conversationId);
    if (snapshot.active) {
      const toolName = evaluation.invocation.toolName;
      if (CANONICAL_NOVEL_WRITES.has(toolName)) {
        return deny("compose.canonical_write_denied");
      }
    } else if (snapshot.mode === "bypass") {
      // 直接执行模式:canonical 写跳过审批直接放行;其余工具(含读/进入)落 base,
      // 不 shadow 基础规则。ExitComposeMode 不在 canonical 写集合,仍走 base → 硬审批门。
      if (CANONICAL_NOVEL_WRITES.has(evaluation.invocation.toolName)) {
        return allow("mode.bypass_canonical_write_allow");
      }
    }
    return this.#base.evaluate(evaluation);
  }
}
