/** NovelDelete tool: batch deletes any Novel entity in the Draft. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import {
  NovelDeleteParametersSchema,
  type NovelDeleteArguments,
  type NovelDeleteDetails,
} from "./schemas.js";
import type { NovelDeleteToolService } from "./ToolService.js";

export interface CreateDeleteToolOptions {
  readonly service: NovelDeleteToolService;
  readonly logger?: Logger;
}

export function createDeleteTool(
  options: CreateDeleteToolOptions,
): RegisteredTool<typeof NovelDeleteParametersSchema, NovelDeleteDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_delete_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelDelete",
      version: "1.0.0",
      label: "Novel Delete",
      description:
        "Batch-deletes Novel entities (story_unit, character, location, paragraph, volume, chapter) in the conversation Draft. The host applies optimistic concurrency automatically. Deletion rejects without cascading when dependencies exist: a story_unit with children or a leaf plan, or a volume that still contains chapters. Deleting a paragraph also removes it from every chapter selection; deleting a chapter keeps its paragraphs under their story units.",
      parameters: NovelDeleteParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Resolve dependencies first: clear a story unit's plan/children before deleting it, and empty a volume before deleting it.",
        parameterGuidance:
          "kind selects the entity type; id is the entity's stable id.",
        safetyGuidance: "Writes are Draft-only until NovelDraftCommit.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.delete(
            context.conversationId,
            arguments_,
          );
          logger.info("novel_delete_tool.delete.completed", {
            conversationId: context.conversationId,
            deletedCount: details.items.filter(
              (item) => item.status === "deleted",
            ).length,
          });
          return deleteResult(details);
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_DELETE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelDelete",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

function deleteResult(
  details: NovelDeleteDetails,
): ToolResult<NovelDeleteDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: "Deletion requested." }),
    ]),
    details,
  });
}
