/** NovelDraftCommit tool: commits the conversation Draft to canonical state. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import {
  NovelDraftCommitParametersSchema,
  type NovelDraftCommitArguments,
  type NovelDraftCommitDetails,
} from "./schemas.js";
import type { NovelDraftToolService } from "./ToolService.js";

export interface CreateDraftCommitToolOptions {
  readonly service: NovelDraftToolService;
  readonly logger?: Logger;
}

export function createDraftCommitTool(
  options: CreateDraftCommitToolOptions,
): RegisteredTool<typeof NovelDraftCommitParametersSchema, NovelDraftCommitDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_draft_commit_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelDraftCommit",
      version: "1.0.0",
      label: "Novel Draft Commit",
      description:
        "Commits the current conversation Draft to canonical Novel state, producing a new revision. If the host requires approval and none is granted yet, returns rejected(approval_required) and the Draft stays active.",
      parameters: NovelDraftCommitParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Only commit when the Draft is ready; approval may be required first.",
        parameterGuidance: "No parameters.",
        safetyGuidance: "Makes Draft changes authoritative; host approval applies.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.commit(
            context.conversationId,
            arguments_,
          );
          logger.info("novel_draft_tool.commit.completed", {
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            status: details.status,
          });
          return writeResult(details);
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_DRAFT_COMMIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelDraftCommit",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

function writeResult(
  details: NovelDraftCommitDetails,
): ToolResult<NovelDraftCommitDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: "Commit requested." }),
    ]),
    details,
  });
}
