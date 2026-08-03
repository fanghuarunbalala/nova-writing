/** Immutable Prompt Recipe snapshot with every Section resolved to an exact version. */
import { captureSectionId, captureVersion } from "../../prompt/PromptPlanItem.js";

export type ResolvedPromptPlanItemKind = "section" | "inline";

export interface ResolvedPromptSectionItemSnapshot {
  readonly kind: "section";
  readonly sectionId: string;
  readonly version: string;
}

export interface ResolvedInlinePromptItemSnapshot {
  readonly kind: "inline";
  readonly sourceId: string;
  readonly content: string;
}

export type ResolvedPromptPlanItemSnapshot =
  | ResolvedPromptSectionItemSnapshot
  | ResolvedInlinePromptItemSnapshot;

export abstract class ResolvedPromptPlanItem {
  abstract readonly kind: ResolvedPromptPlanItemKind;
  abstract toSnapshot(): ResolvedPromptPlanItemSnapshot;
}

export interface ResolvedPromptSectionItemOptions {
  readonly sectionId: string;
  readonly version: string;
}

export class ResolvedPromptSectionItem extends ResolvedPromptPlanItem {
  readonly kind = "section" as const;
  readonly sectionId: string;
  readonly version: string;

  constructor(options: ResolvedPromptSectionItemOptions) {
    super();
    this.sectionId = captureSectionId(options.sectionId);
    this.version = captureVersion(options.version);
    Object.freeze(this);
  }

  toSnapshot(): ResolvedPromptSectionItemSnapshot {
    return Object.freeze({
      kind: this.kind,
      sectionId: this.sectionId,
      version: this.version,
    });
  }
}

export interface ResolvedInlinePromptItemOptions {
  readonly sourceId: string;
  readonly content: string;
}

export class ResolvedInlinePromptItem extends ResolvedPromptPlanItem {
  readonly kind = "inline" as const;
  readonly sourceId: string;
  readonly content: string;

  constructor(options: ResolvedInlinePromptItemOptions) {
    super();
    this.sourceId = captureInlineSourceId(options.sourceId);
    if (
      typeof options.content !== "string" ||
      options.content.trim().length === 0 ||
      options.content.length > 1_024
    ) {
      throw new TypeError("Resolved inline Prompt content is invalid");
    }
    this.content = options.content;
    Object.freeze(this);
  }

  toSnapshot(): ResolvedInlinePromptItemSnapshot {
    return Object.freeze({
      kind: this.kind,
      sourceId: this.sourceId,
      content: this.content,
    });
  }
}

export interface ResolvedPromptRecipeSnapshot {
  readonly items: readonly ResolvedPromptPlanItemSnapshot[];
}

export class ResolvedPromptRecipe {
  readonly items: readonly ResolvedPromptPlanItem[];

  constructor(items: readonly ResolvedPromptPlanItem[]) {
    if (!Array.isArray(items) || items.length === 0 || items.length > 64) {
      throw new TypeError("Resolved Prompt Recipe items are invalid");
    }
    this.items = Object.freeze(
      [...items].map((item) => {
        if (!(item instanceof ResolvedPromptPlanItem)) {
          throw new TypeError("Resolved Prompt Recipe item is invalid");
        }
        return item;
      }),
    );
    Object.freeze(this);
  }

  toSnapshot(): ResolvedPromptRecipeSnapshot {
    return Object.freeze({
      items: Object.freeze(this.items.map((item) => item.toSnapshot())),
    });
  }
}

function captureInlineSourceId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^inline:[1-9]\d*$/.test(value)
  ) {
    throw new TypeError("Resolved inline Prompt source ID is invalid");
  }
  return value;
}
