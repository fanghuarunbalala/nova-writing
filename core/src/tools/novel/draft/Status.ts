/** NovelDraftStatus tool: reads the conversation's active Draft state. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import {
  NovelDraftStatusParametersSchema,
  type NovelDraftStatusArguments,
  type NovelDraftStatusDetails,
} from "./schemas.js";
import type { NovelDraftToolService } from "./ToolService.js";

export interface CreateDraftStatusToolOptions {
  readonly service: NovelDraftToolService;
  readonly logger?: Logger;
}

export function createDraftStatusTool(
  options: CreateDraftStatusToolOptions,
): RegisteredTool<typeof NovelDraftStatusParametersSchema, NovelDraftStatusDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_draft_status_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelDraftStatus",
      version: "1.0.0",
      label: "Novel Draft Status",
      description:
        "Reads the current conversation Draft state: whether an active Draft exists, its status, base revision, and last update. Use before NovelDraftCommit, NovelDraftRollback, or NovelDraftRebase.",
      parameters: NovelDraftStatusParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Call before lifecycle actions to confirm an active Draft exists.",
        parameterGuidance: "No parameters.",
        safetyGuidance: "Read-only.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.status(
            context.conversationId,
            arguments_,
          );
          logger.info("novel_draft_tool.status.completed", {
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            hasDraft: details.draft !== undefined,
          });
          return readResult(details);
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_DRAFT_STATUS_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelDraftStatus",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

function readResult(
  details: NovelDraftStatusDetails,
): ToolResult<NovelDraftStatusDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: "Draft status read." }),
    ]),
    details,
  });
}
