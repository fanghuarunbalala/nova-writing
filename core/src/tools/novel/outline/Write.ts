/** NovelOutlineWrite tool: batch-creates story units in the conversation Draft. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import {
  NovelOutlineWriteParametersSchema,
  type NovelOutlineWriteArguments,
  type NovelOutlineWriteDetails,
} from "./schemas.js";
import type { OutlineToolService } from "./ToolService.js";

export interface CreateWriteToolOptions {
  readonly service: OutlineToolService;
  readonly logger?: Logger;
}

export function createWriteTool(
  options: CreateWriteToolOptions,
): RegisteredTool<typeof NovelOutlineWriteParametersSchema, NovelOutlineWriteDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_outline_write_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelOutlineWrite",
      version: "1.0.0",
      label: "Novel Outline Write",
      description:
        "Batch-creates story units in the conversation Draft. The outline identity is created automatically. New units default to planningStatus=idea, realizationStatus=pending, root parent, and append order. Attach leaf to create the leaf plan in the same call. Items apply in order; the batch stops at the first rejected item.",
      parameters: NovelOutlineWriteParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Omit orderKey to append after the last sibling under the target parent.",
        parameterGuidance:
          "value must be complete. Create fails with duplicate_id when the id already exists.",
        safetyGuidance:
          "Writes are Draft-only until NovelDraftCommit. No digests are required at the tool surface.",
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
          logger.info("novel_outline_tool.write.completed", {
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            appliedCount: details.items.filter(
              (item) => item.status === "appended",
            ).length,
            rejectedCount: details.items.filter(
              (item) => item.status === "rejected",
            ).length,
          });
          return writeResult(details);
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_OUTLINE_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelOutlineWrite",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

function writeResult(
  details: NovelOutlineWriteDetails,
): ToolResult<NovelOutlineWriteDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: "Outline write applied." }),
    ]),
    details,
  });
}
