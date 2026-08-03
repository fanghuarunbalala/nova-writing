/** Class-based Prompt Recipe items with JSON snapshots only at persistence boundaries. */

export type PromptPlanItemKind = "section" | "inline";

export interface PromptSectionItemSnapshot {
  readonly kind: "section";
  readonly sectionId: string;
  readonly version?: string;
}

export interface InlinePromptItemSnapshot {
  readonly kind: "inline";
  readonly content: string;
}

export type PromptPlanItemSnapshot =
  | PromptSectionItemSnapshot
  | InlinePromptItemSnapshot;

export abstract class PromptPlanItem {
  abstract readonly kind: PromptPlanItemKind;
  abstract toSnapshot(): PromptPlanItemSnapshot;
}

export class PromptSectionItem extends PromptPlanItem {
  readonly kind = "section" as const;
  readonly sectionId: string;
  readonly requestedVersion?: string;

  constructor(sectionId: string, requestedVersion?: string) {
    super();
    this.sectionId = captureSectionId(sectionId);
    this.requestedVersion = requestedVersion === undefined
      ? undefined
      : captureVersion(requestedVersion);
    Object.freeze(this);
  }

  toSnapshot(): PromptSectionItemSnapshot {
    return Object.freeze({
      kind: this.kind,
      sectionId: this.sectionId,
      ...(this.requestedVersion === undefined
        ? {}
        : { version: this.requestedVersion }),
    });
  }
}

export class InlinePromptItem extends PromptPlanItem {
  readonly kind = "inline" as const;
  readonly content: string;

  constructor(content: string) {
    super();
    if (
      typeof content !== "string" ||
      content.trim().length === 0 ||
      content.length > 1_024
    ) {
      throw new TypeError("Inline Prompt content is invalid");
    }
    this.content = content;
    Object.freeze(this);
  }

  toSnapshot(): InlinePromptItemSnapshot {
    return Object.freeze({ kind: this.kind, content: this.content });
  }
}

export function captureSectionId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value)
  ) {
    throw new TypeError("Prompt Section ID is invalid");
  }
  return value;
}

export function captureVersion(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
  ) {
    throw new TypeError("Prompt Section version is invalid");
  }
  return value;
}
