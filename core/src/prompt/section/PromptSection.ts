/** Reusable versioned Prompt content rendered from a typed Prompt Context. */
import type { PromptContext } from "../PromptContext.js";
import {
  captureSectionId,
  captureVersion,
} from "../PromptPlanItem.js";

export interface PromptSectionOptions {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  /**
   * 段类别：static 在 manifest 编译期渲染一次；dynamic 由运行时每调用渲染。
   * Section kind: static sections render once at manifest compile time; dynamic
   * sections render per call at runtime.
   */
  readonly kind?: "static" | "dynamic";
}

export abstract class PromptSection {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly kind: "static" | "dynamic";

  protected constructor(options: PromptSectionOptions) {
    this.id = captureSectionId(options.id);
    this.version = captureVersion(options.version);
    if (typeof options.label !== "string" || options.label.trim().length === 0) {
      throw new TypeError("Prompt Section label is invalid");
    }
    this.label = options.label;
    this.kind = options.kind ?? "static";
  }

  abstract render(context: PromptContext): string;
}
