/** NovelOutlineRead tool: reads the canonical outline tree and its current revision. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
} from "../../../tooling/protocol/index.js";
import { formatReadToolResult } from "../readResult.js";
import {
  NovelOutlineReadParametersSchema,
  type NovelOutlineReadArguments,
  type NovelOutlineReadDetails,
} from "./schemas.js";
import type { OutlineToolService } from "./ToolService.js";

export interface CreateReadToolOptions {
  readonly service: OutlineToolService;
  readonly logger?: Logger;
}

export function createReadTool(
  options: CreateReadToolOptions,
): RegisteredTool<typeof NovelOutlineReadParametersSchema, NovelOutlineReadDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_outline_read_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelOutlineRead",
      version: "1.0.0",
      label: "Novel Outline Read",
      description:
        "Reads the canonical story outline. Returns ordered StoryUnit nodes with planning/realization status, optional leaf plans, derived progress, and revision.currentRevision as the optimistic-lock carrier. Use the returned structure as the source for NovelOutlineWrite and NovelOutlineEdit values.",
      parameters: NovelOutlineReadParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Pass revision.currentRevision as baseRevision to a following write or edit to detect concurrent changes.",
        parameterGuidance:
          "Omit storyUnitId for the whole tree. Set includePlans=true to attach leaf plans.",
        safetyGuidance:
          "Read-only. Returns revision.currentRevision for optimistic locking.",
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
          logger.info("novel_outline_tool.read.completed", {
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            unitCount: details.units.length,
          });
          return formatReadToolResult(details, "Outline read.");
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_OUTLINE_READ_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelOutlineRead",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

