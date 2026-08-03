/** Rendered Prompt block preserving source identity until Provider adaptation. */
import {
  capturePromptDigest,
  type PromptDigest,
} from "./PromptDigester.js";

export type PromptBlockSourceKind = "section" | "inline";
export type PromptBlockLayer = "base";

export interface PromptBlockOptions {
  readonly sourceKind: PromptBlockSourceKind;
  readonly sourceId: string;
  readonly sourceVersion?: string;
  readonly layer?: PromptBlockLayer;
  readonly content: string;
  readonly digest: PromptDigest;
}

export class PromptBlock {
  readonly sourceKind: PromptBlockSourceKind;
  readonly sourceId: string;
  readonly sourceVersion?: string;
  readonly layer: PromptBlockLayer;
  readonly content: string;
  readonly digest: PromptDigest;

  constructor(options: PromptBlockOptions) {
    this.sourceKind = options.sourceKind;
    this.sourceId = requireNonBlank(options.sourceId, "Prompt source ID");
    this.sourceVersion = options.sourceVersion;
    this.layer = options.layer ?? "base";
    this.content = requireNonBlank(options.content, "Prompt content");
    this.digest = capturePromptDigest(options.digest);
    Object.freeze(this);
  }
}

function requireNonBlank(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
