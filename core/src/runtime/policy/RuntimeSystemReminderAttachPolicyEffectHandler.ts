/**
 * 渲染并持久化 SystemReminderAttach Policy Effects：经模板注册表渲染正文 →
 * append `SystemReminderAttachedOutputEvent`（投影为 canonical system.reminder），
 * 并把 attachment 返回给 coordinator 收集进 receipt（同 run 注入凭据）。
 * Renders and persists SystemReminderAttach effects: renders content through the
 * template registry, appends a SystemReminderAttachedOutputEvent (projected to a
 * canonical system.reminder message), and returns the attachment so the coordinator
 * can surface it in the receipt for in-run injection.
 */
import { SystemReminderAttachedOutputEvent } from "../../event/output/SystemReminderAttachedOutputEvent.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { RuntimeEventSink } from "../execution/event/RuntimeEventSink.js";
import type { NudgeTemplateRegistry } from "../nudge/index.js";
import type {
  RuntimePolicyContext,
  SystemReminderAttachEffect,
} from "./RuntimePolicyProtocol.js";
import type {
  RuntimeReminderAttachment,
  RuntimeSystemReminderAttachEffectHandler,
} from "./RuntimeEffectCoordinator.js";

export interface RuntimeSystemReminderAttachPolicyEffectHandlerOptions {
  readonly eventSink: RuntimeEventSink;
  readonly templates: NudgeTemplateRegistry;
  readonly logger?: Logger;
}

export class RuntimeSystemReminderAttachPolicyEffectHandler
  implements RuntimeSystemReminderAttachEffectHandler
{
  private readonly eventSink: RuntimeEventSink;
  private readonly templates: NudgeTemplateRegistry;
  private readonly logger: Logger;

  constructor(options: RuntimeSystemReminderAttachPolicyEffectHandlerOptions) {
    this.eventSink = options.eventSink;
    this.templates = options.templates;
    this.logger = (options.logger ?? noopLogger).child({
      component: "system_reminder_attach_policy_effect_handler",
    });
  }

  async handle(
    context: RuntimePolicyContext,
    effect: SystemReminderAttachEffect,
  ): Promise<RuntimeReminderAttachment> {
    if (
      effect.conversationId !== context.conversationId ||
      effect.runId !== context.runId
    ) {
      throw new Error("System Reminder Attach effect identity is invalid");
    }
    const template = this.templates.resolve(
      effect.templateId,
      effect.templateVersion,
    );
    let content: unknown;
    try {
      content = template.render(effect.parameters);
    } catch {
      throw new Error("System reminder template render failed");
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error("System reminder rendered content is invalid");
    }
    await this.eventSink.append(
      new SystemReminderAttachedOutputEvent({
        conversationId: effect.conversationId,
        reminderId: effect.reminderId,
        kind: effect.reminderKind,
        content,
        order: effect.order,
        runId: effect.runId,
      }),
    );
    this.logger.info("runtime.system_reminder.attached", {
      conversationId: effect.conversationId,
      runId: effect.runId,
      reminderId: effect.reminderId,
      reminderKind: effect.reminderKind,
      order: effect.order,
    });
    return Object.freeze({
      reminderId: effect.reminderId,
      kind: effect.reminderKind,
      content,
      order: effect.order,
    });
  }
}
