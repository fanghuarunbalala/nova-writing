/**
 * 通用系统提醒输出事件负载（System reminder attached payload）。
 * Generic system-reminder attached output-event payload.
 *
 * 用于把 todo / nudge / plan 约束 / deferred 名单等动态内容以事件形式持久化，
 * 经 RuntimeMessageProjector 投影为 system.reminder 消息。
 * Carries dynamic content (todos, nudges, plan constraints, deferred-tool lists)
 * as a persisted event that projects to a system.reminder runtime message.
 *
 * 保留语义 / Retention：提醒事件与投影消息永不删除、append-only，保持消息前缀
 * 稳定，避免破坏 provider prefill 缓存。Reminder events and projected messages
 * are never deleted (append-only) so the message prefix stays stable and provider
 * prefill caches are not invalidated.
 */
import type { JsonObject } from "../../protocol/JsonValue.js";
import { OutputPayload } from "../OutputPayload.js";

/** 提醒种类枚举（对齐 CCB attachment 类型）。Reminder kind enum (aligned with CCB attachment types). */
export const REMINDER_KIND = [
  "todo_reminder",
  "task_reminder",
  "plan_constraint",
  "deferred_tools_delta",
  "compact_summary",
  "nudge",
] as const;

export type ReminderKind = (typeof REMINDER_KIND)[number];

/** 校验字符串是否为已注册的提醒种类。Checks whether a string is a registered reminder kind. */
export function isReminderKind(value: unknown): value is ReminderKind {
  return REMINDER_KIND.includes(value as ReminderKind);
}

export interface SystemReminderAttachedPayloadOptions {
  /** 提醒稳定标识（同一种类新状态 = 新 reminderId，旧记录不覆盖）。Stable reminder identity; a new state appends a new id. */
  readonly reminderId: string;
  /** 提醒种类。Reminder kind. */
  readonly kind: ReminderKind;
  /** 提醒正文（producer 渲染的完整文本，如 <CURRENT_TODOS> 块）。Rendered reminder text (e.g. <CURRENT_TODOS> block). */
  readonly content: string;
  /** 消息流内排序序号（同一 provider 调用内多个提醒的稳定顺序）。Stable order within one provider call. */
  readonly order: number;
}

/** 系统提醒输出事件负载值对象。Value object for the system-reminder attached output event. */
export class SystemReminderAttachedPayload extends OutputPayload {
  readonly reminderId: string;
  readonly kind: ReminderKind;
  readonly content: string;
  readonly order: number;

  constructor(options: SystemReminderAttachedPayloadOptions) {
    super();
    this.reminderId = requireNonBlank("Reminder ID", options.reminderId);
    if (!isReminderKind(options.kind)) {
      throw new TypeError("Reminder kind is invalid");
    }
    this.kind = options.kind;
    this.content = requireNonBlank("Reminder content", options.content);
    if (!Number.isSafeInteger(options.order) || options.order < 0) {
      throw new TypeError("Reminder order is invalid");
    }
    this.order = options.order;
  }

  /** 序列化为事件快照 JSON。Serializes to event-snapshot JSON. */
  toObject(): JsonObject {
    return {
      reminderId: this.reminderId,
      kind: this.kind,
      content: this.content,
      order: this.order,
    };
  }
}

function requireNonBlank(label: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
  return value;
}
