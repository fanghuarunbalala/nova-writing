/** NovelOutlineWrite tool: batch-creates story units in the canonical outline after approval. */
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
        "Batch-creates story units in the canonical outline. The outline identity is created automatically. New units default to planningStatus=idea, realizationStatus=pending, root parent, and append order. Attach leaf to create the leaf plan in the same call. The whole batch is approved first, then applied in one atomic transaction; any rejected item leaves the batch unapplied.",
      parameters: NovelOutlineWriteParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Omit orderKey to append after the last sibling under the target parent. baseRevision is required: pass revision.currentRevision from the most recent read; missing or stale revisions are rejected.",
        parameterGuidance:
          "value must be complete. Create fails with duplicate_id when the id already exists.",
        safetyGuidance:
          "Writes require approval and apply to canonical immediately after approval. The returned revision.currentRevision is the new optimistic-lock carrier.",
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
              (item) => item.status === "applied",
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
