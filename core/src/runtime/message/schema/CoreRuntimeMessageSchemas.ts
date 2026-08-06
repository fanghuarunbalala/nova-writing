/**
 * Core schemas for Runtime Messages that are independent of any Agent adapter.
 * 与 Agent 适配器无关的 Core 运行时消息 schema。
 *
 * system.reminder 保留语义 / Retention：提醒消息由 system.reminder.attached 事件
 * 投影而来，append-only、永不删除（压缩/投影/API 转换均保留），保持消息前缀稳定，
 * 避免破坏 provider prefill 缓存。system.reminder messages are projected from
 * system.reminder.attached events, are append-only and never deleted, keeping the
 * message prefix stable so provider prefill caches stay valid.
 */
import { Type } from "typebox";
import { REMINDER_KIND } from "../../../event/output/payload/SystemReminderAttachedPayload.js";
import type { RuntimeMessageSchemaRegistry } from "../RuntimeMessageSchemaRegistry.js";
import { RUNTIME_MESSAGE_SCHEMA_VERSION } from "../RuntimeMessageSnapshot.js";

export const CORE_RUNTIME_MESSAGE_TYPE = {
  userMessage: "user.message",
  assistantMessage: "assistant.message",
  systemReminder: "system.reminder",
} as const;

export const RuntimeTextContentSchema = Type.Object(
  {
    type: Type.Literal("text"),
    text: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const CoreUserRuntimeMessagePayloadSchema = Type.Object(
  {
    content: Type.Array(RuntimeTextContentSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const CoreAssistantRuntimeMessagePayloadSchema = Type.Object(
  {
    content: Type.Array(RuntimeTextContentSchema),
  },
  { additionalProperties: false },
);

/** 系统提醒消息负载 schema（kind/content/order）。System-reminder message payload schema. */
export const SystemReminderRuntimeMessagePayloadSchema = Type.Object(
  {
    kind: Type.Union(REMINDER_KIND.map((kind) => Type.Literal(kind))),
    content: Type.String({ minLength: 1 }),
    order: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export function registerCoreRuntimeMessageSchemas(
  registry: RuntimeMessageSchemaRegistry,
): void {
  registry.register({
    role: "user",
    messageType: CORE_RUNTIME_MESSAGE_TYPE.userMessage,
    schemaVersion: RUNTIME_MESSAGE_SCHEMA_VERSION,
    payloadSchema: CoreUserRuntimeMessagePayloadSchema,
  });
  registry.register({
    role: "assistant",
    messageType: CORE_RUNTIME_MESSAGE_TYPE.assistantMessage,
    schemaVersion: RUNTIME_MESSAGE_SCHEMA_VERSION,
    payloadSchema: CoreAssistantRuntimeMessagePayloadSchema,
  });
  registry.register({
    role: "system",
    messageType: CORE_RUNTIME_MESSAGE_TYPE.systemReminder,
    schemaVersion: RUNTIME_MESSAGE_SCHEMA_VERSION,
    payloadSchema: SystemReminderRuntimeMessagePayloadSchema,
  });
}
