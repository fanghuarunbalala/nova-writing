/** NovelCharacterRead tool: reads Character profiles for one explicit scope. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import {
  NovelCharacterReadParametersSchema,
  type NovelCharacterReadArguments,
  type NovelCharacterReadDetails,
} from "./schemas.js";
import type { NovelCharacterToolService } from "./ToolService.js";

export interface CreateCharacterReadToolOptions {
  readonly service: NovelCharacterToolService;
  readonly logger?: Logger;
}

export function createCharacterReadTool(
  options: CreateCharacterReadToolOptions,
): RegisteredTool<typeof NovelCharacterReadParametersSchema, NovelCharacterReadDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_character_read_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelCharacterRead",
      version: "1.0.0",
      label: "Novel Character Read",
      description:
        "Reads Character profiles for one explicit scope. Omit characterId to list all. The returned profile is the source for NovelCharacterWrite and NovelCharacterEdit values.",
      parameters: NovelCharacterReadParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Use scope=draft to preview uncommitted work or canonical for committed state.",
        parameterGuidance:
          "Omit characterId for the whole list; provide it to read one profile.",
        safetyGuidance: "Read-only.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.read(
            context.conversationId,
            arguments_,
          );
          logger.info("novel_character_tool.read.completed", {
            conversationId: context.conversationId,
            characterCount: details.characters.length,
          });
          return readResult(details);
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_CHARACTER_READ_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelCharacterRead",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

function readResult(
  details: NovelCharacterReadDetails,
): ToolResult<NovelCharacterReadDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: "Characters read." }),
    ]),
    details,
  });
}
