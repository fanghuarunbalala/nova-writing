/**
 * novel.global_constraints 动态段：每调用渲染一段常驻说明，并在标签内注入项目根
 * NOVEL.md（小说全局约束/meta）的当前内容。
 * Novel global-constraints dynamic section: renders standing instructions per
 * call and injects the current content of the project-root NOVEL.md (novel
 * meta/global constraints) inside a tag.
 *
 * 该段只依赖 workspace 与 NOVEL.md 位置两个固定事实，因此常驻说明（读取语义、
 * 内容约束）始终渲染，不随文件是否有内容而变化；文件内容作为可选部分在标签内
 * 呈现，无内容时给出占位提示。动态段不进 base，因此 NOVEL.md 改动不破坏 manifest
 * digest；文件内容由 node 层每调用读取并经动态段输入传入，prompt 层保持
 * provider-neutral（不接触 node:fs）。
 * The section depends only on the two fixed facts (workspace and the NOVEL.md
 * location), so its standing instructions (read semantics, content constraints)
 * always render regardless of the file's content; the file content is an
 * optional part presented inside a tag, with a placeholder when absent. Dynamic
 * sections never enter the base, so NOVEL.md edits do not disturb the manifest
 * digest; the node layer reads the file per call and passes it through the
 * dynamic section input, keeping the prompt layer provider-neutral (no node:fs).
 */
import { DynamicPromptSection, type DynamicPromptSectionInput } from "../../section/DynamicPromptSection.js";

/** 小说全局约束默认文件名（沙盒根下的相对路径）。Default file name for the novel global-constraints file (relative path under the sandbox root). */
const DEFAULT_NOVEL_GLOBAL_CONSTRAINTS_FILE_NAME = "NOVEL.md";

/**
 * 小说全局约束快照：node 层每调用读取 NOVEL.md 后注入动态段输入。
 * Novel global-constraints snapshot: injected into the dynamic section input after the
 * node layer reads NOVEL.md per call.
 */
export interface NovelGlobalConstraintsSnapshot {
  /** 文件名（如 NOVEL.md），用于块标题。File name (e.g. NOVEL.md) used in the block heading. */
  readonly fileName: string;
  /** 文件内容（UTF-8，≤256 KiB）。File content (UTF-8, ≤256 KiB). */
  readonly content: string;
}

export class NovelGlobalConstraintsPromptSection extends DynamicPromptSection {
  constructor() {
    super({
      id: "novel.global_constraints",
      version: "1.0.0",
      label: "Novel Global Constraints",
    });
  }

  /** 编译期不产生内容（动态段不进 base）。No content at compile time (dynamic sections never enter the base). */
  override render(): string {
    return "";
  }

  /** 每调用渲染小说全局约束块：常驻说明 + 以 <Novel-Constraints-Content> 包裹的当前文件内容。 */
  /** Renders the novel global-constraints block per call: standing instructions plus the current file content wrapped in <Novel-Constraints-Content>. */
  override renderDynamic(input: DynamicPromptSectionInput): string {
    const snapshot = input.novelGlobalConstraints;
    const fileName =
      snapshot?.fileName ?? DEFAULT_NOVEL_GLOBAL_CONSTRAINTS_FILE_NAME;
    const content = snapshot?.content.trim();
    const body =
      content !== undefined && content.length > 0
        ? content
        : "（当前无可用内容，若你需要维护小说全局约束，用 Write 创建该文件后按上述约束写入。）";
    return [
      `# 小说全局约束（${fileName}）`,
      "",
      "- 读取：每次 Provider Call 都会重新读取该文件并注入此处，你用 Write/Edit 修改后即时生效。",
      "- 内容约束：此文件仅记录小说 meta/全局约束（书名、类型、世界观、角色规则、基调、禁忌、作者偏好等），不写入对话、任务或实现细节。",
      "",
      `以下是 ${fileName} 的当前内容：`,
      "",
      "<Novel-Constraints-Content>",
      body,
      "</Novel-Constraints-Content>",
    ].join("\n");
  }
}
