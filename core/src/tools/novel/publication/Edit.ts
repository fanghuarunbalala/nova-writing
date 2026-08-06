/** NovelVolumeEdit and NovelChapterEdit tools: field-level PATCH updates. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { JsonValue } from "../../../event/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import {
  NovelChapterEditParametersSchema,
  NovelVolumeEditParametersSchema,
  type NovelChapterEditArguments,
  type NovelChapterWriteDetails,
  type NovelVolumeEditArguments,
  type NovelVolumeWriteDetails,
} from "./schemas.js";
import type { NovelPublicationToolService } from "./ToolService.js";

export interface CreateVolumeEditToolOptions {
  readonly service: NovelPublicationToolService;
  readonly logger?: Logger;
}

export function createVolumeEditTool(
  options: CreateVolumeEditToolOptions,
): RegisteredTool<typeof NovelVolumeEditParametersSchema, NovelVolumeWriteDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_volume_edit_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelVolumeEdit",
      version: "1.0.0",
      label: "Novel Volume Edit",
      description:
        "Field-level PATCH updates for Volumes: provided fields overwrite, omitted fields are untouched.",
      parameters: NovelVolumeEditParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Edit title or orderKey; omitted fields keep their values.",
        parameterGuidance: "id is required; title/orderKey are optional.",
        safetyGuidance: "Writes are Draft-only until NovelDraftCommit.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.editVolumes(
            context.conversationId,
            arguments_,
          );
          logger.info("novel_publication_tool.volume.edit.completed", {
            conversationId: context.conversationId,
            appliedCount: details.items.filter(
              (item) => item.status === "applied",
            ).length,
          });
          return editResult(details, "Volumes edited.");
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_VOLUME_EDIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelVolumeEdit",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

export interface CreateChapterEditToolOptions {
  readonly service: NovelPublicationToolService;
  readonly logger?: Logger;
}

export function createChapterEditTool(
  options: CreateChapterEditToolOptions,
): RegisteredTool<typeof NovelChapterEditParametersSchema, NovelChapterWriteDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_chapter_edit_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelChapterEdit",
      version: "1.0.0",
      label: "Novel Chapter Edit",
      description:
        "Field-level PATCH updates for Chapters. Providing paragraphIds replaces the whole ordered selection (this is how you split, merge, or resequence Chapter content, including ending a Chapter mid-StoryUnit); paragraphIds: null clears the selection. volumeId/title/orderKey patch individually.",
      parameters: NovelChapterEditParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "To split a Chapter, provide the new tail list to the next Chapter and the shortened list to this one.",
        parameterGuidance:
          "id is required. paragraphIds, when provided, is the complete replacement list.",
        safetyGuidance: "Writes are Draft-only until NovelDraftCommit.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.editChapters(
            context.conversationId,
            arguments_,
          );
          logger.info("novel_publication_tool.chapter.edit.completed", {
            conversationId: context.conversationId,
            appliedCount: details.items.filter(
              (item) => item.status === "applied",
            ).length,
          });
          return editResult(details, "Chapters edited.");
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_CHAPTER_EDIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelChapterEdit",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

function editResult<T extends JsonValue>(
  details: T,
  message: string,
): ToolResult<T> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: message }),
    ]),
    details,
  });
}
