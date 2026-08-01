/** Versioned in-memory registry for trusted local Nudge templates. */
import type { JsonValue } from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  NUDGE_TEMPLATE_FAILURE,
  NudgeTemplateError,
} from "./NudgeTemplateErrors.js";

export interface NudgeTemplate {
  readonly templateId: string;
  readonly templateVersion: string;
  render(parameters: Readonly<Record<string, JsonValue>>): string;
}

export interface NudgeTemplateRegistryOptions {
  readonly logger?: Logger;
}

export class NudgeTemplateRegistry {
  private readonly templates = new Map<string, NudgeTemplate>();
  private readonly logger: Logger;

  constructor(options: NudgeTemplateRegistryOptions = {}) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "nudge_template_registry",
    });
  }

  register(template: NudgeTemplate): void {
    const templateId = captureNonBlank(template?.templateId);
    const templateVersion = captureNonBlank(template?.templateVersion);
    if (!templateId || !templateVersion || typeof template.render !== "function") {
      this.logFailure(NUDGE_TEMPLATE_FAILURE.invalidTemplate, templateId, templateVersion);
      throw new NudgeTemplateError(
        NUDGE_TEMPLATE_FAILURE.invalidTemplate,
        templateId,
        templateVersion,
      );
    }

    const key = templateKey(templateId, templateVersion);
    if (this.templates.has(key)) {
      this.logFailure(
        NUDGE_TEMPLATE_FAILURE.duplicateTemplate,
        templateId,
        templateVersion,
      );
      throw new NudgeTemplateError(
        NUDGE_TEMPLATE_FAILURE.duplicateTemplate,
        templateId,
        templateVersion,
      );
    }

    this.templates.set(
      key,
      Object.freeze({
        templateId,
        templateVersion,
        render: template.render,
      }),
    );
    this.logger.info("runtime.nudge.template_registered", {
      templateId,
      templateVersion,
    });
  }

  resolve(templateIdValue: string, templateVersionValue: string): NudgeTemplate {
    const templateId = captureNonBlank(templateIdValue);
    const templateVersion = captureNonBlank(templateVersionValue);
    if (!templateId || !templateVersion) {
      this.logFailure(NUDGE_TEMPLATE_FAILURE.invalidTemplate, templateId, templateVersion);
      throw new NudgeTemplateError(
        NUDGE_TEMPLATE_FAILURE.invalidTemplate,
        templateId,
        templateVersion,
      );
    }

    const template = this.templates.get(templateKey(templateId, templateVersion));
    if (!template) {
      this.logFailure(
        NUDGE_TEMPLATE_FAILURE.templateNotFound,
        templateId,
        templateVersion,
      );
      throw new NudgeTemplateError(
        NUDGE_TEMPLATE_FAILURE.templateNotFound,
        templateId,
        templateVersion,
      );
    }
    this.logger.debug("runtime.nudge.template_resolved", {
      templateId,
      templateVersion,
    });
    return template;
  }

  private logFailure(
    failure: NudgeTemplateError["failure"],
    templateId?: string,
    templateVersion?: string,
  ): void {
    this.logger.error("runtime.nudge.template_failed", {
      failure,
      ...(templateId ? { templateId } : {}),
      ...(templateVersion ? { templateVersion } : {}),
    });
  }
}

function templateKey(templateId: string, templateVersion: string): string {
  return `${templateId}\u0000${templateVersion}`;
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
