/**
 * novel.global_constraints 动态段：每调用把项目根 NOVEL.md（小说全局约束/meta）注入 system prompt。
 * Novel global-constraints dynamic section: injects the project-root NOVEL.md (novel meta/global
 * constraints) into the system prompt per call.
 *
 * 与 core.environment 同一模式：编译期（无输入）不产生内容；运行时由 node 层读取文件内容，
 * 经动态段输入传入，prompt 层保持 provider-neutral（不接触 node:fs）。动态段不进 base，
 * 因此 NOVEL.md 改动不破坏 manifest digest。
 * Same pattern as core.environment: nothing at compile time (no input); at runtime the node
 * layer reads the file and passes content via the dynamic section input, keeping the prompt
 * layer provider-neutral (no node:fs). Dynamic sections never enter the base, so NOVEL.md
 * edits do not disturb the manifest digest.
 */
import { DynamicPromptSection, type DynamicPromptSectionInput } from "../../section/DynamicPromptSection.js";

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

  /** 每调用渲染小说全局约束块；输入缺失或内容为空时返回空串。 */
  /** Renders the novel global-constraints block per call; empty when the input is absent or blank. */
  override renderDynamic(input: DynamicPromptSectionInput): string {
    const constraints = input.novelGlobalConstraints;
    if (
      constraints === undefined ||
      constraints.content.trim().length === 0
    ) {
      return "";
    }
    return [
      `# 小说全局约束（${constraints.fileName}）`,
      "",
      constraints.content.trim(),
      "",
      "此文件仅记录小说 meta/全局约束，由你用 Write/Edit 维护；修改时只写入小说相关的全局约束。",
    ].join("\n");
  }
}
