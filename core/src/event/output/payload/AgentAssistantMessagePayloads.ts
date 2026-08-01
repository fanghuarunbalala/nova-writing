/** Core-owned Assistant draft payloads independent from Pi and Provider types. */
import type { JsonObject } from "../../protocol/JsonValue.js";
import { OutputPayload } from "../OutputPayload.js";

export const ASSISTANT_MESSAGE_DELTA_CHANNEL = {
  text: "text",
  thinking: "thinking",
} as const;

export type AssistantMessageDeltaChannel =
  (typeof ASSISTANT_MESSAGE_DELTA_CHANNEL)[keyof typeof ASSISTANT_MESSAGE_DELTA_CHANNEL];

export const ASSISTANT_MESSAGE_COMPLETION_REASON = {
  stop: "stop",
  length: "length",
  toolUse: "tool_use",
} as const;

export type AssistantMessageCompletionReason =
  (typeof ASSISTANT_MESSAGE_COMPLETION_REASON)[keyof typeof ASSISTANT_MESSAGE_COMPLETION_REASON];

export const ASSISTANT_MESSAGE_FAILURE_CODE = {
  providerError: "provider_error",
  providerAborted: "provider_aborted",
} as const;

export type AssistantMessageFailureCode =
  (typeof ASSISTANT_MESSAGE_FAILURE_CODE)[keyof typeof ASSISTANT_MESSAGE_FAILURE_CODE];

export interface AssistantTextContent {
  readonly type: "text";
  readonly text: string;
}

export interface AssistantThinkingContent {
  readonly type: "thinking";
  readonly thinking: string;
  readonly redacted?: boolean;
}

export type AssistantMessageContent =
  | AssistantTextContent
  | AssistantThinkingContent;

export class AgentAssistantMessageStartedPayload extends OutputPayload {
  readonly assistantMessageId: string;

  constructor(assistantMessageId: string) {
    super();
    this.assistantMessageId = captureNonBlank("Assistant Message ID", assistantMessageId);
  }

  toObject(): JsonObject {
    return { assistantMessageId: this.assistantMessageId };
  }
}

export interface AgentAssistantMessageDeltaPayloadOptions {
  assistantMessageId: string;
  deltaOrdinal: number;
  contentIndex: number;
  channel: AssistantMessageDeltaChannel;
  delta: string;
}

export class AgentAssistantMessageDeltaPayload extends OutputPayload {
  readonly assistantMessageId: string;
  readonly deltaOrdinal: number;
  readonly contentIndex: number;
  readonly channel: AssistantMessageDeltaChannel;
  readonly delta: string;

  constructor(options: AgentAssistantMessageDeltaPayloadOptions) {
    super();
    this.assistantMessageId = captureNonBlank(
      "Assistant Message ID",
      options.assistantMessageId,
    );
    assertNonNegative("Delta ordinal", options.deltaOrdinal);
    assertNonNegative("Content index", options.contentIndex);
    if (!Object.values(ASSISTANT_MESSAGE_DELTA_CHANNEL).includes(options.channel)) {
      throw new TypeError("Assistant Message delta channel is invalid");
    }
    if (typeof options.delta !== "string" || options.delta.length === 0) {
      throw new TypeError("Assistant Message delta must not be empty");
    }
    this.deltaOrdinal = options.deltaOrdinal;
    this.contentIndex = options.contentIndex;
    this.channel = options.channel;
    this.delta = options.delta;
  }

  toObject(): JsonObject {
    return {
      assistantMessageId: this.assistantMessageId,
      deltaOrdinal: this.deltaOrdinal,
      contentIndex: this.contentIndex,
      channel: this.channel,
      delta: this.delta,
    };
  }
}

export interface AgentAssistantMessageCompletedPayloadOptions {
  assistantMessageId: string;
  content: readonly AssistantMessageContent[];
  completionReason: AssistantMessageCompletionReason;
  hasToolCalls: boolean;
}

export class AgentAssistantMessageCompletedPayload extends OutputPayload {
  readonly assistantMessageId: string;
  readonly content: readonly AssistantMessageContent[];
  readonly completionReason: AssistantMessageCompletionReason;
  readonly hasToolCalls: boolean;

  constructor(options: AgentAssistantMessageCompletedPayloadOptions) {
    super();
    this.assistantMessageId = captureNonBlank(
      "Assistant Message ID",
      options.assistantMessageId,
    );
    if (!Array.isArray(options.content)) {
      throw new TypeError("Assistant Message content must be an array");
    }
    if (!Object.values(ASSISTANT_MESSAGE_COMPLETION_REASON).includes(options.completionReason)) {
      throw new TypeError("Assistant Message completion reason is invalid");
    }
    if (typeof options.hasToolCalls !== "boolean") {
      throw new TypeError("Assistant Message Tool-call flag must be boolean");
    }
    this.content = Object.freeze(options.content.map(captureContent));
    this.completionReason = options.completionReason;
    this.hasToolCalls = options.hasToolCalls;
  }

  toObject(): JsonObject {
    return {
      assistantMessageId: this.assistantMessageId,
      content: this.content.map((item) => ({ ...item })),
      completionReason: this.completionReason,
      hasToolCalls: this.hasToolCalls,
    };
  }
}

export class AgentAssistantMessageFailedPayload extends OutputPayload {
  readonly assistantMessageId: string;
  readonly failureCode: AssistantMessageFailureCode;

  constructor(assistantMessageId: string, failureCode: AssistantMessageFailureCode) {
    super();
    this.assistantMessageId = captureNonBlank("Assistant Message ID", assistantMessageId);
    if (!Object.values(ASSISTANT_MESSAGE_FAILURE_CODE).includes(failureCode)) {
      throw new TypeError("Assistant Message failure code is invalid");
    }
    this.failureCode = failureCode;
  }

  toObject(): JsonObject {
    return {
      assistantMessageId: this.assistantMessageId,
      failureCode: this.failureCode,
    };
  }
}

export class AgentAssistantMessageCancelledPayload extends OutputPayload {
  readonly assistantMessageId: string;

  constructor(assistantMessageId: string) {
    super();
    this.assistantMessageId = captureNonBlank("Assistant Message ID", assistantMessageId);
  }

  toObject(): JsonObject {
    return { assistantMessageId: this.assistantMessageId };
  }
}

function captureContent(content: AssistantMessageContent): AssistantMessageContent {
  if (content?.type === "text" && typeof content.text === "string") {
    return Object.freeze({ type: "text", text: content.text });
  }
  if (
    content?.type === "thinking" &&
    typeof content.thinking === "string" &&
    (content.redacted === undefined || typeof content.redacted === "boolean")
  ) {
    return Object.freeze({
      type: "thinking",
      thinking: content.thinking,
      ...(content.redacted !== undefined ? { redacted: content.redacted } : {}),
    });
  }
  throw new TypeError("Assistant Message content block is invalid");
}

function captureNonBlank(label: string, value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
  return value;
}

function assertNonNegative(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}
