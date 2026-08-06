/** NovelParagraphEdit tool: field-level PATCH updates for Paragraphs. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import {
  NovelParagraphEditParametersSchema,
  type NovelParagraphEditArguments,
  type NovelParagraphWriteDetails,
} from "./schemas.js";
import type { NovelParagraphToolService } from "./ToolService.js";

export interface CreateParagraphEditToolOptions {
  readonly service: NovelParagraphToolService;
  readonly logger?: Logger;
}

export function createParagraphEditTool(
  options: CreateParagraphEditToolOptions,
): RegisteredTool<typeof NovelParagraphEditParametersSchema, NovelParagraphWriteDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_paragraph_edit_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelParagraphEdit",
      version: "1.0.0",
      label: "Novel Paragraph Edit",
      description:
        "Field-level PATCH updates for Paragraphs: provided fields overwrite, omitted fields are untouched. Changing storyUnitId moves the Paragraph to another StoryUnit; changing orderKey reorders it. Text cannot be null.",
      parameters: NovelParagraphEditParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Edit the fields you want to change; omitted fields keep their values.",
        parameterGuidance:
          "id is required. text/orderKey/storyUnitId are optional.",
        safetyGuidance: "Writes are Draft-only until NovelDraftCommit.",
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
          logger.info("novel_paragraph_tool.edit.completed", {
            conversationId: context.conversationId,
            appliedCount: details.items.filter(
              (item) => item.status === "applied",
            ).length,
          });
          return editResult(details);
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_PARAGRAPH_EDIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelParagraphEdit",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

function editResult(
  details: NovelParagraphWriteDetails,
): ToolResult<NovelParagraphWriteDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: "Paragraphs edited." }),
    ]),
    details,
  });
}
