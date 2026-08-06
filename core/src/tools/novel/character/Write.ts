/** NovelCharacterWrite tool: batch-creates Character profiles in the Draft. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import {
  NovelCharacterWriteParametersSchema,
  type NovelCharacterWriteArguments,
  type NovelCharacterWriteDetails,
} from "./schemas.js";
import type { NovelCharacterToolService } from "./ToolService.js";

export interface CreateCharacterWriteToolOptions {
  readonly service: NovelCharacterToolService;
  readonly logger?: Logger;
}

export function createCharacterWriteTool(
  options: CreateCharacterWriteToolOptions,
): RegisteredTool<typeof NovelCharacterWriteParametersSchema, NovelCharacterWriteDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_character_write_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelCharacterWrite",
      version: "1.0.0",
      label: "Novel Character Write",
      description:
        "Batch-creates Character profiles in the conversation Draft. id is optional; when omitted the host generates and returns it. Create fails with duplicate_id when the id already exists. Items apply in order; the batch stops at the first rejected item.",
      parameters: NovelCharacterWriteParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Omit id to let the host generate one. Use the returned id for later NovelCharacterEdit calls.",
        parameterGuidance:
          "name is required and aliases may be empty. summary/initialState/authorNotes are optional.",
        safetyGuidance:
          "Writes are Draft-only until NovelDraftCommit.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.write(
            context.conversationId,
            arguments_,
          );
          logger.info("novel_character_tool.write.completed", {
            conversationId: context.conversationId,
            appliedCount: details.items.filter(
              (item) => item.status === "appended",
            ).length,
          });
          return writeResult(details);
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_CHARACTER_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelCharacterWrite",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

function writeResult(
  details: NovelCharacterWriteDetails,
): ToolResult<NovelCharacterWriteDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: "Characters written." }),
    ]),
    details,
  });
}
