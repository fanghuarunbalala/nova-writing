/** NovelLocationEdit tool: batch field-level partial updates of Location profiles. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import {
  NovelLocationEditParametersSchema,
  type NovelLocationEditArguments,
  type NovelLocationWriteDetails,
} from "./schemas.js";
import type { NovelLocationToolService } from "./ToolService.js";

export interface CreateLocationEditToolOptions {
  readonly service: NovelLocationToolService;
  readonly logger?: Logger;
}

export function createLocationEditTool(
  options: CreateLocationEditToolOptions,
): RegisteredTool<typeof NovelLocationEditParametersSchema, NovelLocationWriteDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_location_edit_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelLocationEdit",
      version: "1.0.0",
      label: "Novel Location Edit",
      description:
        "Batch field-level partial updates (PATCH) of existing Location profiles in the Draft. Provided fields overwrite, omitted fields stay, and null clears summary/initialState/authorNotes. aliases replaces the whole array when provided. id is required.",
      parameters: NovelLocationEditParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Read first with NovelLocationRead, then Edit only the fields you need.",
        parameterGuidance:
          "Use null to clear summary/initialState/authorNotes; use [] to clear aliases.",
        safetyGuidance: "Edits are Draft-only until NovelDraftCommit.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.edit(
            context.conversationId,
            arguments_,
          );
          logger.info("novel_location_tool.edit.completed", {
            conversationId: context.conversationId,
            appliedCount: details.items.filter(
              (item) => item.status === "applied",
            ).length,
          });
          return editResult(details);
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_LOCATION_EDIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelLocationEdit",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

function editResult(
  details: NovelLocationWriteDetails,
): ToolResult<NovelLocationWriteDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: "Locations edited." }),
    ]),
    details,
  });
}
