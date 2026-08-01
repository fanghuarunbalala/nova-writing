/** Renders leased Nudges into one temporary, redaction-safe overlay boundary. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  NUDGE_PLACEMENT,
  NUDGE_SELECTION_LIMIT,
  PENDING_NUDGE_STATE,
  type PendingNudge,
  type SystemReminderOverlay,
} from "./NudgeProtocol.js";
import {
  capturePendingNudge,
  captureSystemReminderOverlay,
} from "./NudgeProtocolValidator.js";
import {
  NUDGE_TEMPLATE_FAILURE,
  NudgeTemplateError,
} from "./NudgeTemplateErrors.js";
import { NudgeTemplateRegistry } from "./NudgeTemplateRegistry.js";

export interface NudgeRendererOptions {
  readonly templates: NudgeTemplateRegistry;
  readonly logger?: Logger;
  readonly separator?: string;
}

export class NudgeRenderer {
  private readonly templates: NudgeTemplateRegistry;
  private readonly logger: Logger;
  private readonly separator: string;

  constructor(options: NudgeRendererOptions) {
    this.templates = options.templates;
    this.logger = (options.logger ?? noopLogger).child({
      component: "nudge_renderer",
    });
    this.separator = options.separator ?? "\n\n";
  }

  render(nudges: readonly PendingNudge[]): SystemReminderOverlay {
    this.logger.debug("runtime.nudge.render_started", {
      nudgeCount: Array.isArray(nudges) ? nudges.length : 0,
    });

    try {
      if (
        !Array.isArray(nudges) ||
        nudges.length < 1 ||
        nudges.length > NUDGE_SELECTION_LIMIT.maximum
      ) {
        throw new NudgeTemplateError(NUDGE_TEMPLATE_FAILURE.invalidNudges);
      }

      const captured = nudges.map((nudge) => {
        try {
          return capturePendingNudge(nudge);
        } catch {
          throw new NudgeTemplateError(NUDGE_TEMPLATE_FAILURE.invalidNudges);
        }
      });
      if (captured.some((nudge) => nudge.state !== PENDING_NUDGE_STATE.leased)) {
        throw new NudgeTemplateError(NUDGE_TEMPLATE_FAILURE.invalidNudges);
      }
      if (new Set(captured.map((nudge) => nudge.id)).size !== captured.length) {
        throw new NudgeTemplateError(NUDGE_TEMPLATE_FAILURE.invalidNudges);
      }
      if (captured.some((nudge) => nudge.exclusive) && captured.length !== 1) {
        throw new NudgeTemplateError(NUDGE_TEMPLATE_FAILURE.invalidNudges);
      }

      const content = captured
        .map((nudge) => this.renderOne(nudge))
        .join(this.separator);
      const overlay = captureSystemReminderOverlay({
        placement: NUDGE_PLACEMENT.systemPromptOverlay,
        nudgeIds: captured.map((nudge) => nudge.id),
        content,
      });
      this.logger.info("runtime.nudge.render_completed", {
        nudgeCount: overlay.nudgeIds.length,
      });
      return overlay;
    } catch (error) {
      const normalized =
        error instanceof NudgeTemplateError
          ? error
          : new NudgeTemplateError(NUDGE_TEMPLATE_FAILURE.invalidRenderedOutput);
      this.logger.error("runtime.nudge.render_failed", {
        failure: normalized.failure,
      });
      throw normalized;
    }
  }

  private renderOne(nudge: PendingNudge): string {
    const template = this.templates.resolve(
      nudge.templateId,
      nudge.templateVersion,
    );
    let rendered: unknown;
    try {
      rendered = template.render(nudge.parameters);
    } catch {
      throw new NudgeTemplateError(
        NUDGE_TEMPLATE_FAILURE.renderFailed,
        nudge.templateId,
        nudge.templateVersion,
      );
    }
    if (typeof rendered !== "string" || rendered.trim().length === 0) {
      throw new NudgeTemplateError(
        NUDGE_TEMPLATE_FAILURE.invalidRenderedOutput,
        nudge.templateId,
        nudge.templateVersion,
      );
    }
    return rendered;
  }
}
