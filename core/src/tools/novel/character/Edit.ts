/** NovelCharacterEdit tool: batch field-level partial updates of Character profiles. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import {
  NovelCharacterEditParametersSchema,
  type NovelCharacterEditArguments,
  type NovelCharacterWriteDetails,
} from "./schemas.js";
import type { NovelCharacterToolService } from "./ToolService.js";

export interface CreateCharacterEditToolOptions {
  readonly service: NovelCharacterToolService;
  readonly logger?: Logger;
}

export function createCharacterEditTool(
  options: CreateCharacterEditToolOptions,
): RegisteredTool<typeof NovelCharacterEditParametersSchema, NovelCharacterWriteDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_character_edit_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelCharacterEdit",
      version: "1.0.0",
      label: "Novel Character Edit",
      description:
        "Batch field-level partial updates (PATCH) of existing Character profiles in the Draft. Provided fields overwrite, omitted fields stay, and null clears summary/initialState/authorNotes. aliases replaces the whole array when provided. id is required.",
      parameters: NovelCharacterEditParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Read first with NovelCharacterRead, then Edit only the fields you need.",
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
          logger.info("novel_character_tool.edit.completed", {
            conversationId: context.conversationId,
            appliedCount: details.items.filter(
              (item) => item.status === "applied",
            ).length,
          });
          return editResult(details);
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_CHARACTER_EDIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelCharacterEdit",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

function editResult(
  details: NovelCharacterWriteDetails,
): ToolResult<NovelCharacterWriteDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: "Characters edited." }),
    ]),
    details,
  });
}
