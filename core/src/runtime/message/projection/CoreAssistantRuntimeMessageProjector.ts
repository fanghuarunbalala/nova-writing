/**
 * Projects completed Assistant output into canonical text history.
 * 投影所有 completed 助手消息（含工具调用轮次的文本回复）；
 * 仅当没有任何文本内容时不投影。
 */
import { OUTPUT_EVENT_TYPE } from "../../../event/index.js";
import type { JsonObject } from "../../../event/index.js";
import type { PersistedConversationEventSnapshot } from "../../../storage/index.js";
import {
  RUNTIME_MESSAGE_SCHEMA_VERSION,
  type RuntimeMessageDraft,
} from "../RuntimeMessageSnapshot.js";
import { CORE_RUNTIME_MESSAGE_TYPE } from "../schema/CoreRuntimeMessageSchemas.js";
import { RuntimeMessageProjectionError } from "./RuntimeMessageProjectionError.js";
import type { RuntimeMessageProjector } from "./RuntimeMessageProjector.js";

const COMPLETION_REASONS = new Set(["stop", "length", "tool_use"]);

export class CoreAssistantRuntimeMessageProjector implements RuntimeMessageProjector {
  readonly id = "core.assistant-message";
  // 行为变更（含工具调用轮次的文本），版本递增以触发消息投影自动重建。
  readonly version = "2";

  project(event: PersistedConversationEventSnapshot): readonly RuntimeMessageDraft[] {
    if (
      event.direction !== "output" ||
      event.eventType !== OUTPUT_EVENT_TYPE.agentAssistantMessageCompleted
    ) {
      return [];
    }

    const payload = this.capturePayload(event.payload, event.id);

    const runId = captureNonBlank(event.runId);
    const turnId = captureNonBlank(event.turnId);
    if (runId === undefined || turnId === undefined) {
      throw this.fail("Completed Assistant event identity is invalid", event.id);
    }

    const content = payload.content.flatMap((item) =>
      item.type === "text" && item.text.length > 0
        ? [{ type: "text" as const, text: item.text }]
        : [],
    );
    if (content.length === 0) return [];
    return [
      {
        role: "assistant",
        messageType: CORE_RUNTIME_MESSAGE_TYPE.assistantMessage,
        schemaVersion: RUNTIME_MESSAGE_SCHEMA_VERSION,
        timestamp: event.timestamp,
        runId,
        turnId,
        payload: { content },
      },
    ];
  }

  private capturePayload(payload: JsonObject, eventId: string): CompletedAssistantPayload {
    const assistantMessageId = captureNonBlank(payload.assistantMessageId);
    if (
      assistantMessageId === undefined ||
      !Array.isArray(payload.content) ||
      typeof payload.completionReason !== "string" ||
      !COMPLETION_REASONS.has(payload.completionReason) ||
      typeof payload.hasToolCalls !== "boolean"
    ) {
      throw this.fail("Completed Assistant event payload is invalid", eventId);
    }

    const content = payload.content.map((item) => this.captureContent(item, eventId));
    return Object.freeze({
      assistantMessageId,
      content: Object.freeze(content),
      hasToolCalls: payload.hasToolCalls,
    });
  }

  private captureContent(value: unknown, eventId: string): CompletedAssistantContent {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw this.fail("Completed Assistant content is invalid", eventId);
    }
    const content = value as Record<string, unknown>;
    if (content.type === "text" && typeof content.text === "string") {
      return Object.freeze({ type: "text", text: content.text });
    }
    if (
      content.type === "thinking" &&
      typeof content.thinking === "string" &&
      (content.redacted === undefined || typeof content.redacted === "boolean")
    ) {
      return Object.freeze({ type: "thinking" });
    }
    throw this.fail("Completed Assistant content is invalid", eventId);
  }

  private fail(message: string, eventId: string): RuntimeMessageProjectionError {
    return new RuntimeMessageProjectionError(message, this.id, eventId);
  }
}

interface CompletedAssistantPayload {
  readonly assistantMessageId: string;
  readonly content: readonly CompletedAssistantContent[];
  readonly hasToolCalls: boolean;
}

type CompletedAssistantContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "thinking" };

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
