/**
 * Compose 感知的权限包装策略：compose 激活时拒绝 canonical 写入并限定文件工具作用域，
 * 非激活时透传基础策略（恢复进入前的权限行为）。
 * Compose-aware permission wrapper: while compose is active it denies canonical
 * writes and scopes file tools; otherwise it passes through to the base policy.
 */
import * as path from "node:path";
import type { ComposeModeSnapshot } from "../../compose/index.js";
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

/** runtime.files 工具。File tools. */
const FILE_TOOLS: ReadonlySet<string> = new Set(["Read", "Glob", "Write", "Edit"]);

/** Compose 模式下文件工具作用域判定：读∈design 目录、写==design 文件、Glob 模式安全。 */
/** File-tool scope check while compose is active. */
function fileToolInScope(
  toolName: string,
  arguments_: unknown,
  snapshot: ComposeModeSnapshot,
): boolean {
  if (snapshot.designFilePath === undefined) return false;
  const designRoot = path.dirname(snapshot.designFilePath);
  if (toolName === "Read") {
    const filePath = readString(arguments_, "file_path");
    return filePath !== undefined && isInside(designRoot, path.resolve(filePath));
  }
  if (toolName === "Write" || toolName === "Edit") {
    const filePath = readString(arguments_, "file_path");
    return (
      filePath !== undefined &&
      path.resolve(filePath) === path.resolve(snapshot.designFilePath)
    );
  }
  if (toolName === "Glob") {
    const pattern = readString(arguments_, "pattern");
    return (
      pattern !== undefined &&
      !path.isAbsolute(pattern) &&
      !pattern.split(/[\\/]/).includes("..")
    );
  }
  return false;
}

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

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
      if (FILE_TOOLS.has(toolName)) {
        // compose 激活时，作用域内文件工具直接放行；越界拒绝。
        // While compose is active, in-scope file tools are allowed; out-of-scope denied.
        return fileToolInScope(toolName, evaluation.invocation.arguments, snapshot)
          ? allow("compose.file_in_scope")
          : deny("compose.file_outside_design");
      }
    }
    return this.#base.evaluate(evaluation);
  }
}
