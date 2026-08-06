/** NovelParagraphWrite tool: batch-creates Paragraphs in the Draft. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import {
  NovelParagraphWriteParametersSchema,
  type NovelParagraphWriteArguments,
  type NovelParagraphWriteDetails,
} from "./schemas.js";
import type { NovelParagraphToolService } from "./ToolService.js";

export interface CreateParagraphWriteToolOptions {
  readonly service: NovelParagraphToolService;
  readonly logger?: Logger;
}

export function createParagraphWriteTool(
  options: CreateParagraphWriteToolOptions,
): RegisteredTool<typeof NovelParagraphWriteParametersSchema, NovelParagraphWriteDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_paragraph_write_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelParagraphWrite",
      version: "1.0.0",
      label: "Novel Paragraph Write",
      description:
        "Batch-creates Paragraphs under a StoryUnit in the conversation Draft. id is optional; when omitted the host generates and returns it. orderKey is optional and appends after the last sibling. Create fails with duplicate_id when the id already exists.",
      parameters: NovelParagraphWriteParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Omit id to let the host generate one. Use the returned id for NovelParagraphEdit.",
        parameterGuidance:
          "storyUnitId and text are required; orderKey appends when omitted.",
        safetyGuidance: "Writes are Draft-only until NovelDraftCommit.",
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
          logger.info("novel_paragraph_tool.write.completed", {
            conversationId: context.conversationId,
            appliedCount: details.items.filter(
              (item) => item.status === "appended",
            ).length,
          });
          return writeResult(details);
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_PARAGRAPH_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelParagraphWrite",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

function writeResult(
  details: NovelParagraphWriteDetails,
): ToolResult<NovelParagraphWriteDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: "Paragraphs written." }),
    ]),
    details,
  });
}
