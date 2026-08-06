/** NovelParagraphRead tool: reads Paragraphs for one explicit scope. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import {
  NovelParagraphReadParametersSchema,
  type NovelParagraphReadArguments,
  type NovelParagraphReadDetails,
} from "./schemas.js";
import type { NovelParagraphToolService } from "./ToolService.js";

export interface CreateParagraphReadToolOptions {
  readonly service: NovelParagraphToolService;
  readonly logger?: Logger;
}

export function createParagraphReadTool(
  options: CreateParagraphReadToolOptions,
): RegisteredTool<typeof NovelParagraphReadParametersSchema, NovelParagraphReadDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_paragraph_read_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelParagraphRead",
      version: "1.0.0",
      label: "Novel Paragraph Read",
      description:
        "Reads Paragraphs in StoryUnit order for one explicit scope. Omit storyUnitId to read all Paragraphs. Use the returned ids and orderKey as the source for NovelParagraphWrite and NovelParagraphEdit.",
      parameters: NovelParagraphReadParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Use scope=draft to preview uncommitted work or canonical for committed state.",
        parameterGuidance:
          "Pass storyUnitId to read one StoryUnit's paragraphs in order.",
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
          logger.info("novel_paragraph_tool.read.completed", {
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            paragraphCount: details.paragraphs.length,
          });
          return readResult(details);
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_PARAGRAPH_READ_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelParagraphRead",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

function readResult(
  details: NovelParagraphReadDetails,
): ToolResult<NovelParagraphReadDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: "Paragraphs read." }),
    ]),
    details,
  });
}
