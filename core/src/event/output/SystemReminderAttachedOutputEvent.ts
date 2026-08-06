/**
 * 通用系统提醒附加输出事件（System reminder attached output event）。
 * Generic system-reminder attached output event.
 *
 * 由 reminder producer（todo / nudge / plan / deferred）持久化，经
 * CoreReminderRuntimeMessageProjector 投影为 system.reminder 消息。
 * Persisted by reminder producers and projected to a system.reminder message.
 */
import { OUTPUT_EVENT_TYPE } from "./OutputEventType.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";
import { SystemOutputEvent } from "./SystemOutputEvent.js";
import {
  SystemReminderAttachedPayload,
  type SystemReminderAttachedPayloadOptions,
} from "./payload/SystemReminderAttachedPayload.js";

export type SystemReminderAttachedOutputEventOptions = Omit<
  OutputEventOptions,
  "runId"
> &
  SystemReminderAttachedPayloadOptions & {
    readonly runId: string;
  };

/** 系统提醒附加输出事件类。System-reminder attached output event class. */
export class SystemReminderAttachedOutputEvent extends SystemOutputEvent {
  constructor(options: SystemReminderAttachedOutputEventOptions) {
    const { runId, ...eventOptions } = options;
    assertNonBlank("Run ID", runId);
    super(
      "reminder.attached",
      new SystemReminderAttachedPayload(options),
      { ...eventOptions, runId },
    );
  }

  /** 返回稳定事件类型。Returns the stable event type. */
  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.systemReminderAttached;
  }
}

function assertNonBlank(label: string, value: unknown): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
}
