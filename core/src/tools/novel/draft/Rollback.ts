/** NovelDraftRollback tool: discards the conversation Draft. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import {
  NovelDraftRollbackParametersSchema,
  type NovelDraftRollbackArguments,
  type NovelDraftRollbackDetails,
} from "./schemas.js";
import type { NovelDraftToolService } from "./ToolService.js";

export interface CreateDraftRollbackToolOptions {
  readonly service: NovelDraftToolService;
  readonly logger?: Logger;
}

export function createDraftRollbackTool(
  options: CreateDraftRollbackToolOptions,
): RegisteredTool<typeof NovelDraftRollbackParametersSchema, NovelDraftRollbackDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_draft_rollback_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelDraftRollback",
      version: "1.0.0",
      label: "Novel Draft Rollback",
      description:
        "Discards all uncommitted changes in the current conversation Draft and ends it. The Draft cannot be recovered after this.",
      parameters: NovelDraftRollbackParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Use when abandoning the current Draft entirely.",
        parameterGuidance: "No parameters.",
        safetyGuidance: "Permanently discards the active Draft; host approval applies.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.rollback(
            context.conversationId,
            arguments_,
          );
          logger.info("novel_draft_tool.rollback.completed", {
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            status: details.status,
          });
          return writeResult(details);
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_DRAFT_ROLLBACK_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelDraftRollback",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

function writeResult(
  details: NovelDraftRollbackDetails,
): ToolResult<NovelDraftRollbackDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: "Rollback requested." }),
    ]),
    details,
  });
}
