/**
 * 将 system.reminder.attached 输出事件投影为 system.reminder 运行时消息。
 * Projects system.reminder.attached output events into system.reminder runtime messages.
 *
 * 保留语义 / Retention：投影结果 append-only、永不删除，保持消息前缀稳定以
 * 保护 provider prefill 缓存。Projected messages are append-only and never
 * deleted to keep the message prefix stable for provider prefill caching.
 */
import { OUTPUT_EVENT_TYPE } from "../../../event/output/OutputEventType.js";
import {
  REMINDER_KIND,
  type ReminderKind,
} from "../../../event/output/payload/SystemReminderAttachedPayload.js";
import type { JsonObject } from "../../../event/index.js";
import type { PersistedConversationEventSnapshot } from "../../../storage/index.js";
import {
  RUNTIME_MESSAGE_SCHEMA_VERSION,
  type RuntimeMessageDraft,
} from "../RuntimeMessageSnapshot.js";
import { CORE_RUNTIME_MESSAGE_TYPE } from "../schema/CoreRuntimeMessageSchemas.js";
import { RuntimeMessageProjectionError } from "./RuntimeMessageProjectionError.js";
import type { RuntimeMessageProjector } from "./RuntimeMessageProjector.js";

/** 系统提醒消息投影器：事件 → 消息。System-reminder message projector: event → message. */
export class CoreReminderRuntimeMessageProjector
  implements RuntimeMessageProjector
{
  readonly id = "core.reminder-message";
  readonly version = "1";

  /** 投影输出事件为消息草稿；非本事件返回空数组。Projects the output event; returns [] for unrelated events. */
  project(event: PersistedConversationEventSnapshot): readonly RuntimeMessageDraft[] {
    if (
      event.direction !== "output" ||
      event.eventType !== OUTPUT_EVENT_TYPE.systemReminderAttached
    ) {
      return [];
    }

    const payload = this.capturePayload(event.payload, event.id);
    return [
      {
        role: "system",
        messageType: CORE_RUNTIME_MESSAGE_TYPE.systemReminder,
        schemaVersion: RUNTIME_MESSAGE_SCHEMA_VERSION,
        timestamp: event.timestamp,
        ...(event.runId !== undefined ? { runId: event.runId } : {}),
        ...(event.turnId !== undefined ? { turnId: event.turnId } : {}),
        payload: {
          kind: payload.kind,
          content: payload.content,
          order: payload.order,
        },
      },
    ];
  }

  private capturePayload(
    value: JsonObject,
    eventId: string,
  ): { kind: ReminderKind; content: string; order: number } {
    const kind = value.kind;
    const content = value.content;
    const order = value.order;
    if (
      typeof kind !== "string" ||
      !REMINDER_KIND.includes(kind as ReminderKind) ||
      typeof content !== "string" ||
      content.length === 0 ||
      !Number.isSafeInteger(order) ||
      (order as number) < 0
    ) {
      throw new RuntimeMessageProjectionError(
        "System reminder event payload is invalid",
        this.id,
        eventId,
      );
    }
    return Object.freeze({
      kind: kind as ReminderKind,
      content,
      order: order as number,
    });
  }
}
