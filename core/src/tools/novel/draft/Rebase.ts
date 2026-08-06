/** NovelDraftRebase tool: rebuilds the Draft onto the latest canonical state. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import {
  NovelDraftRebaseParametersSchema,
  type NovelDraftRebaseArguments,
  type NovelDraftRebaseDetails,
} from "./schemas.js";
import type { NovelDraftToolService } from "./ToolService.js";

export interface CreateDraftRebaseToolOptions {
  readonly service: NovelDraftToolService;
  readonly logger?: Logger;
}

export function createDraftRebaseTool(
  options: CreateDraftRebaseToolOptions,
): RegisteredTool<typeof NovelDraftRebaseParametersSchema, NovelDraftRebaseDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_draft_rebase_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelDraftRebase",
      version: "1.0.0",
      label: "Novel Draft Rebase",
      description:
        "Rebuilds the current conversation Draft onto the latest canonical revision. Returns not_required when canonical has not advanced, rebased on success, or conflicted with a conflict summary when entries cannot be replayed automatically. Conflict resolution stays in the host.",
      parameters: NovelDraftRebaseParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Use after another session committed to canonical state.",
        parameterGuidance: "No parameters.",
        safetyGuidance: "Changes the Draft base; host approval applies.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.rebase(
            context.conversationId,
            arguments_,
          );
          logger.info("novel_draft_tool.rebase.completed", {
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            status: details.status,
            conflictCount: details.conflictCount ?? 0,
          });
          return writeResult(details);
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_DRAFT_REBASE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelDraftRebase",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

function writeResult(
  details: NovelDraftRebaseDetails,
): ToolResult<NovelDraftRebaseDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: "Rebase requested." }),
    ]),
    details,
  });
}
