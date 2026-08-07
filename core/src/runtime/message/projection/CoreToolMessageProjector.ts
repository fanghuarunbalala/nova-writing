/**
 * 工具请求/结果消息投影器：把 system.tool.request/result.recorded 输出事件
 * 投影为 tool.request / tool.result 运行时消息，供跨轮上下文重建。
 * Projects tool request/result events into runtime tool messages for context rebuild.
 */
import { OUTPUT_EVENT_TYPE } from "../../../event/output/OutputEventType.js";
import type { JsonObject, JsonValue } from "../../../event/index.js";
import type { PersistedConversationEventSnapshot } from "../../../storage/index.js";
import {
  RUNTIME_MESSAGE_SCHEMA_VERSION,
  type RuntimeMessageDraft,
} from "../RuntimeMessageSnapshot.js";
import { CORE_RUNTIME_MESSAGE_TYPE } from "../schema/CoreRuntimeMessageSchemas.js";
import { RuntimeMessageProjectionError } from "./RuntimeMessageProjectionError.js";
import type { RuntimeMessageProjector } from "./RuntimeMessageProjector.js";

export class CoreToolMessageProjector implements RuntimeMessageProjector {
  readonly id = "core.tool-message";
  readonly version = "1";

  project(
    event: PersistedConversationEventSnapshot,
  ): readonly RuntimeMessageDraft[] {
    if (event.direction !== "output") return [];
    if (event.eventType === OUTPUT_EVENT_TYPE.toolRequestRecorded) {
      const payload = capturePayload(event, event.id);
      const toolCallId = captureNonBlank(payload.toolCallId);
      const toolName = captureNonBlank(payload.toolName);
      if (toolCallId === undefined || toolName === undefined) {
        throw this.fail("Tool request payload is invalid", event.id);
      }
      const runId = captureNonBlank(event.runId);
      const turnId = captureNonBlank(event.turnId);
      return [
        {
          role: "tool",
          messageType: CORE_RUNTIME_MESSAGE_TYPE.toolRequest,
          schemaVersion: RUNTIME_MESSAGE_SCHEMA_VERSION,
          timestamp: event.timestamp,
          ...(runId === undefined ? {} : { runId }),
          ...(turnId === undefined ? {} : { turnId }),
          payload: {
            toolCallId,
            toolName,
            arguments: payload.arguments as JsonValue,
          },
        },
      ];
    }
    if (event.eventType === OUTPUT_EVENT_TYPE.toolResultRecorded) {
      const payload = capturePayload(event, event.id);
      const toolCallId = captureNonBlank(payload.toolCallId);
      const toolName = captureNonBlank(payload.toolName);
      if (
        toolCallId === undefined ||
        toolName === undefined ||
        (payload.outcome !== "ok" && payload.outcome !== "failed")
      ) {
        throw this.fail("Tool result payload is invalid", event.id);
      }
      const runId = captureNonBlank(event.runId);
      const turnId = captureNonBlank(event.turnId);
      return [
        {
          role: "tool",
          messageType: CORE_RUNTIME_MESSAGE_TYPE.toolResult,
          schemaVersion: RUNTIME_MESSAGE_SCHEMA_VERSION,
          timestamp: event.timestamp,
          ...(runId === undefined ? {} : { runId }),
          ...(turnId === undefined ? {} : { turnId }),
          payload: {
            toolCallId,
            toolName,
            outcome: payload.outcome,
            ...(payload.result === undefined
              ? {}
              : { result: payload.result as JsonValue }),
            ...(payload.errorCode === undefined
              ? {}
              : { errorCode: captureNonBlank(payload.errorCode) }),
            truncated: payload.truncated === true,
          },
        },
      ];
    }
    return [];
  }

  private fail(
    message: string,
    eventId: string,
  ): RuntimeMessageProjectionError {
    return new RuntimeMessageProjectionError(message, this.id, eventId);
  }
}

function capturePayload(
  event: PersistedConversationEventSnapshot,
  eventId: string,
): Record<string, unknown> {
  if (
    event.payload === null ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    throw new RuntimeMessageProjectionError(
      "Tool event payload is invalid",
      "core.tool-message",
      eventId,
    );
  }
  return event.payload as Record<string, unknown>;
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
