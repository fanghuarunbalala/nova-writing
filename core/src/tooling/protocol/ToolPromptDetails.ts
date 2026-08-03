/** Optional provider-neutral guidance rendered into an Agent's Base Prompt. */

export interface ToolPromptDetailsSnapshot {
  readonly usage?: string;
  readonly parameterGuidance?: string;
  readonly safetyGuidance?: string;
}

export class ToolPromptDetails {
  readonly usage?: string;
  readonly parameterGuidance?: string;
  readonly safetyGuidance?: string;

  constructor(options: ToolPromptDetailsSnapshot) {
    if (!isPlainRecord(options)) {
      throw new TypeError("Tool Prompt Details are invalid");
    }
    const unknownKeys = Object.keys(options).filter(
      (key) => key !== "usage" &&
        key !== "parameterGuidance" &&
        key !== "safetyGuidance",
    );
    if (unknownKeys.length > 0) {
      throw new TypeError("Tool Prompt Details contain unknown fields");
    }
    this.usage = captureOptionalText(options.usage, "Tool usage guidance");
    this.parameterGuidance = captureOptionalText(
      options.parameterGuidance,
      "Tool parameter guidance",
    );
    this.safetyGuidance = captureOptionalText(
      options.safetyGuidance,
      "Tool safety guidance",
    );
    if (
      this.usage === undefined &&
      this.parameterGuidance === undefined &&
      this.safetyGuidance === undefined
    ) {
      throw new TypeError("Tool Prompt Details must contain guidance");
    }
    Object.freeze(this);
  }

  toSnapshot(): ToolPromptDetailsSnapshot {
    return Object.freeze({
      ...(this.usage === undefined ? {} : { usage: this.usage }),
      ...(this.parameterGuidance === undefined
        ? {}
        : { parameterGuidance: this.parameterGuidance }),
      ...(this.safetyGuidance === undefined
        ? {}
        : { safetyGuidance: this.safetyGuidance }),
    });
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function captureOptionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
