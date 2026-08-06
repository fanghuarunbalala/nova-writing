/** NovelOutlineEdit tool: batch field-level partial updates of canonical story units after approval. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import {
  NovelOutlineEditParametersSchema,
  type NovelOutlineEditArguments,
  type NovelOutlineWriteDetails,
} from "./schemas.js";
import type { OutlineToolService } from "./ToolService.js";

export interface CreateEditToolOptions {
  readonly service: OutlineToolService;
  readonly logger?: Logger;
}

export function createEditTool(
  options: CreateEditToolOptions,
): RegisteredTool<typeof NovelOutlineEditParametersSchema, NovelOutlineWriteDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_outline_edit_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelOutlineEdit",
      version: "1.0.0",
      label: "Novel Outline Edit",
      description:
        "Batch field-level partial updates (PATCH) of existing canonical story units. Provided fields overwrite, omitted fields are untouched, and null clears an optional field or array. leaf:null clears the whole plan. parentId:null moves to root; providing orderKey reorders. Moving is expressed as an Edit of parentId/orderKey. The batch is approved first and applied in one atomic transaction.",
      parameters: NovelOutlineEditParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Read first with NovelOutlineRead, modify the fields you need, pass revision.currentRevision as baseRevision, then Edit only those fields.",
        parameterGuidance:
          "Provide null to clear intent/synopsis/scope/blockState/abandonment/leaf. Array fields replace the whole array when provided.",
        safetyGuidance:
          "Edits require approval and apply to canonical immediately after approval. Any rejected item leaves the batch unapplied.",
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
          logger.info("novel_outline_tool.edit.completed", {
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
          return editResult(details);
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_OUTLINE_EDIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelOutlineEdit",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

function editResult(
  details: NovelOutlineWriteDetails,
): ToolResult<NovelOutlineWriteDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: "Outline edit applied." }),
    ]),
    details,
  });
}
