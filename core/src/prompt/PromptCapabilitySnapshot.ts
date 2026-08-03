/** Immutable Tool capability metadata available while rendering base Prompt sections. */

import type { ToolPromptDetailsSnapshot } from "../tooling/protocol/ToolPromptDetails.js";

export interface PromptToolCapabilityOptions {
  readonly name: string;
  readonly version: string;
  readonly label: string;
  readonly description: string;
  readonly promptDetails?: ToolPromptDetailsSnapshot;
}

export class PromptToolCapability {
  readonly name: string;
  readonly version: string;
  readonly label: string;
  readonly description: string;
  readonly promptDetails?: ToolPromptDetailsSnapshot;

  constructor(options: PromptToolCapabilityOptions) {
    this.name = requireNonBlank(options.name, "Tool name");
    this.version = requireNonBlank(options.version, "Tool version");
    this.label = requireNonBlank(options.label, "Tool label");
    this.description = requireNonBlank(options.description, "Tool description");
    this.promptDetails = options.promptDetails === undefined
      ? undefined
      : Object.freeze({ ...options.promptDetails });
    Object.freeze(this);
  }
}

export class PromptCapabilitySnapshot {
  readonly tools: readonly PromptToolCapability[];

  constructor(tools: readonly PromptToolCapabilityOptions[]) {
    const seen = new Set<string>();
    this.tools = Object.freeze(
      [...tools]
        .map((tool) => new PromptToolCapability(tool))
        .sort(compareTools)
        .map((tool) => {
          if (seen.has(tool.name)) {
            throw new TypeError("Prompt Tool capabilities must be unique");
          }
          seen.add(tool.name);
          return tool;
        }),
    );
    Object.freeze(this);
  }
}

function compareTools(
  left: PromptToolCapability,
  right: PromptToolCapability,
): number {
  return left.name.localeCompare(right.name);
}

function requireNonBlank(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
