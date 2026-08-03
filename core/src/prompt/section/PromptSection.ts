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
}

export abstract class PromptSection {
  readonly id: string;
  readonly version: string;
  readonly label: string;

  protected constructor(options: PromptSectionOptions) {
    this.id = captureSectionId(options.id);
    this.version = captureVersion(options.version);
    if (typeof options.label !== "string" || options.label.trim().length === 0) {
      throw new TypeError("Prompt Section label is invalid");
    }
    this.label = options.label;
  }

  abstract render(context: PromptContext): string;
}
