/**
 * 一次 provider 调用的最终不可变 prompt 与消息候选。
 * Immutable final Prompt and Message candidate for one provider call.
 *
 * systemPrompt 恒为 base 内容；动态内容以 system.reminder 消息存在于 messages 中。
 * The system prompt is always the base content; dynamic content lives in
 * system.reminder messages inside `messages`.
 */
import type { RuntimeMessageSnapshot } from "../../runtime/message/index.js";
import {
  capturePromptDigest,
  type PromptDigest,
} from "../PromptDigester.js";
import type { PromptBase } from "../PromptDigester.js";

export interface PromptAssemblyOptions {
  readonly conversationId: string;
  readonly runId: string;
  readonly basePrompt: PromptBase;
  readonly messages: readonly RuntimeMessageSnapshot[];
  readonly messageHighWatermark: number;
  readonly systemPrompt: string;
  readonly digest: PromptDigest;
}

export interface PromptAssemblySnapshot {
  readonly conversationId: string;
  readonly runId: string;
  readonly basePromptDigest: PromptDigest;
  readonly messages: readonly RuntimeMessageSnapshot[];
  readonly messageHighWatermark: number;
  readonly systemPrompt: string;
  readonly digest: PromptDigest;
}

export class PromptAssembly {
  readonly conversationId: string;
  readonly runId: string;
  readonly basePrompt: PromptBase;
  readonly messages: readonly RuntimeMessageSnapshot[];
  readonly messageHighWatermark: number;
  readonly systemPrompt: string;
  readonly digest: PromptDigest;

  constructor(options: PromptAssemblyOptions) {
    this.conversationId = requireIdentity(options.conversationId, "Conversation ID");
    this.runId = requireIdentity(options.runId, "Run ID");
    if (!options.basePrompt || typeof options.basePrompt.content !== "string") {
      throw new TypeError("Prompt Assembly Base Prompt is invalid");
    }
    if (!Array.isArray(options.messages)) {
      throw new TypeError("Prompt Assembly messages are invalid");
    }
    if (!Number.isSafeInteger(options.messageHighWatermark) || options.messageHighWatermark < 0) {
      throw new TypeError("Prompt Assembly Message High Watermark is invalid");
    }
    if (typeof options.systemPrompt !== "string" || options.systemPrompt.trim().length === 0) {
      throw new TypeError("Prompt Assembly system Prompt is invalid");
    }
    this.basePrompt = options.basePrompt;
    this.messages = Object.freeze(options.messages.map((message) => freezeJsonClone(message)));
    this.messageHighWatermark = options.messageHighWatermark;
    this.systemPrompt = options.systemPrompt;
    this.digest = capturePromptDigest(options.digest);
    Object.freeze(this);
  }

  toSnapshot(): PromptAssemblySnapshot {
    return Object.freeze({
      conversationId: this.conversationId,
      runId: this.runId,
      basePromptDigest: this.basePrompt.digest,
      messages: this.messages,
      messageHighWatermark: this.messageHighWatermark,
      systemPrompt: this.systemPrompt,
      digest: this.digest,
    });
  }
}

function requireIdentity(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function freezeJsonClone<T>(value: T): T {
  const clone = JSON.parse(JSON.stringify(value)) as T;
  return deepFreeze(clone);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}
