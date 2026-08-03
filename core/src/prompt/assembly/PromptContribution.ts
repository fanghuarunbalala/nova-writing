/** Immutable Prompt source contribution retained through one Provider-call assembly. */
import { capturePromptDigest, type PromptDigest } from "../PromptDigester.js";

export type PromptLayerKind = "base" | "checkpoint" | "nudge";

export type PromptContributionKind =
  | "core_section"
  | "agent_section"
  | "inline"
  | "tool_guidance"
  | "checkpoint"
  | "nudge";

export type PromptContributionPersistence =
  | "manifest"
  | "checkpoint"
  | "one_shot";

export interface PromptContributionOptions {
  readonly kind: PromptContributionKind;
  readonly sourceId: string;
  readonly sourceVersion?: string;
  readonly layer: PromptLayerKind;
  readonly persistence: PromptContributionPersistence;
  readonly order: number;
  readonly content: string;
  readonly digest: PromptDigest;
}

export interface PromptContributionSnapshot {
  readonly kind: PromptContributionKind;
  readonly sourceId: string;
  readonly sourceVersion?: string;
  readonly layer: PromptLayerKind;
  readonly persistence: PromptContributionPersistence;
  readonly order: number;
  readonly content: string;
  readonly digest: PromptDigest;
}

export class PromptContribution {
  readonly kind: PromptContributionKind;
  readonly sourceId: string;
  readonly sourceVersion?: string;
  readonly layer: PromptLayerKind;
  readonly persistence: PromptContributionPersistence;
  readonly order: number;
  readonly content: string;
  readonly digest: PromptDigest;

  constructor(options: PromptContributionOptions) {
    if (!isContributionKind(options.kind)) {
      throw new TypeError("Prompt Contribution kind is invalid");
    }
    if (!isLayer(options.layer)) {
      throw new TypeError("Prompt Contribution layer is invalid");
    }
    if (!isPersistence(options.persistence)) {
      throw new TypeError("Prompt Contribution persistence is invalid");
    }
    if (!Number.isSafeInteger(options.order) || options.order < 0) {
      throw new TypeError("Prompt Contribution order is invalid");
    }
    if (options.kind === "checkpoint" && options.layer !== "checkpoint") {
      throw new TypeError("Checkpoint Prompt Contribution layer is invalid");
    }
    if (options.kind === "nudge" && options.layer !== "nudge") {
      throw new TypeError("Nudge Prompt Contribution layer is invalid");
    }
    if (options.layer === "base" && options.persistence !== "manifest") {
      throw new TypeError("Base Prompt Contribution persistence is invalid");
    }
    this.sourceId = captureIdentity(options.sourceId, "Prompt Contribution source ID");
    this.sourceVersion = options.sourceVersion === undefined
      ? undefined
      : captureVersion(options.sourceVersion);
    this.kind = options.kind;
    this.layer = options.layer;
    this.persistence = options.persistence;
    this.order = options.order;
    this.content = requireNonBlank(options.content, "Prompt Contribution content");
    this.digest = capturePromptDigest(options.digest);
    Object.freeze(this);
  }

  toSnapshot(): PromptContributionSnapshot {
    return Object.freeze({
      kind: this.kind,
      sourceId: this.sourceId,
      ...(this.sourceVersion === undefined
        ? {}
        : { sourceVersion: this.sourceVersion }),
      layer: this.layer,
      persistence: this.persistence,
      order: this.order,
      content: this.content,
      digest: this.digest,
    });
  }
}

function isContributionKind(value: unknown): value is PromptContributionKind {
  return value === "core_section" ||
    value === "agent_section" ||
    value === "inline" ||
    value === "tool_guidance" ||
    value === "checkpoint" ||
    value === "nudge";
}

function isLayer(value: unknown): value is PromptLayerKind {
  return value === "base" || value === "checkpoint" || value === "nudge";
}

function isPersistence(
  value: unknown,
): value is PromptContributionPersistence {
  return value === "manifest" || value === "checkpoint" || value === "one_shot";
}

function captureIdentity(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function captureVersion(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
  ) {
    throw new TypeError("Prompt Contribution version is invalid");
  }
  return value;
}

function requireNonBlank(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
