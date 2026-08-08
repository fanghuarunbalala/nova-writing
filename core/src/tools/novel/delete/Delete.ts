/** NovelDelete tool: batch deletes any Novel entity in the Draft. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import { formatReadToolResult } from "../readResult.js";
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
        "Batch-deletes Novel entities (story_unit, character, location, paragraph, volume, chapter) in the conversation Draft. The host applies optimistic concurrency automatically. By default (cascade:false) an entity with dependencies is rejected: a story_unit with children, a leaf plan, or paragraphs, or a volume that still contains chapters, or a chapter still bound to paragraphs. With cascade:true the delete cascades to dependents — a story_unit deletes its whole subtree (units, leaf plans, and paragraphs), a volume deletes its chapters, a chapter unbinds its paragraphs — and every entity actually deleted is returned as a complete record. Deleting a paragraph also removes it from every chapter selection; deleting a chapter keeps its paragraphs under their story units.",
      parameters: NovelDeleteParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "For strict semantics leave cascade false and resolve dependencies first (clear a story unit's plan/children or empty a volume before deleting it). To delete a parent together with everything it contains, pass cascade:true; the result includes the full records of all deleted entities.",
        parameterGuidance:
          "kind selects the entity type; id is the entity's stable id; cascade true deletes dependents with the parent and returns them.",
        safetyGuidance:
          "baseRevision is required: pass revision.currentRevision from the most recent read; missing or stale revisions are rejected. Writes require approval and apply to canonical immediately after approval.",
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
            appliedCount: details.items.filter(
              (item) => item.status === "applied",
            ).length,
            ...(details.error === undefined
              ? {}
              : { errorName: "NovelDeleteInBandFailure" }),
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
  const success =
    details.error === undefined &&
    details.items.every((item) => item.status === "applied");
  // 被删数据与错误内容都在 details 里，序列化进 content 让 provider 当轮可见。
  return formatReadToolResult(
    details,
    success ? "Deletion applied." : "Deletion rejected.",
  );
}
