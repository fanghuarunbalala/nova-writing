/**
 * 共享的 reminder policy 效果构造器：模块级计数器保证同进程内 order 全局唯一
 * （SystemReminderAttachedPayload 要求同一 provider 调用内顺序稳定，多个 policy
 * 不能各自从 0 起）。process restart 后归零可接受——order 仅作同调用内稳定排序，
 * 跨调用/跨进程由 reminderId 区分。
 */
import type { JsonValue } from "../../../event/index.js";
import type { ReminderKind } from "../../../event/output/payload/SystemReminderAttachedPayload.js";
import type { SystemReminderAttachEffect } from "../../policy/index.js";

let nextOrder = 0;

export interface CreateSystemReminderAttachEffectInput {
  readonly policyId: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly reminderId: string;
  readonly reminderKind: ReminderKind;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly parameters: Readonly<Record<string, JsonValue>>;
}

export function createSystemReminderAttachEffect(
  input: CreateSystemReminderAttachEffectInput,
): SystemReminderAttachEffect {
  nextOrder += 1;
  return Object.freeze({
    kind: "system_reminder_attach",
    policyId: input.policyId,
    conversationId: input.conversationId,
    runId: input.runId,
    reminderId: input.reminderId,
    reminderKind: input.reminderKind,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    parameters: input.parameters,
    order: nextOrder,
  });
}
