/** NovelVolumeRead and NovelChapterRead tools for committed state. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import { formatReadToolResult } from "../readResult.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
} from "../../../tooling/protocol/index.js";
import {
  NovelChapterReadParametersSchema,
  NovelVolumeReadParametersSchema,
  type NovelChapterReadArguments,
  type NovelChapterReadDetails,
  type NovelVolumeReadArguments,
  type NovelVolumeReadDetails,
} from "./schemas.js";
import type { NovelPublicationToolService } from "./ToolService.js";

export interface CreateVolumeReadToolOptions {
  readonly service: NovelPublicationToolService;
  readonly logger?: Logger;
}

export function createVolumeReadTool(
  options: CreateVolumeReadToolOptions,
): RegisteredTool<typeof NovelVolumeReadParametersSchema, NovelVolumeReadDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_volume_read_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelVolumeRead",
      version: "1.0.0",
      label: "Novel Volume Read",
      description:
        "Reads all Volumes in order, returning each Volume's id, title, and orderKey only. Use NovelChapterRead to inspect Chapter contents and selections.",
      parameters: NovelVolumeReadParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Reads committed (canonical) state; only approved writes appear in results.",
        parameterGuidance: "No required parameters.",
        safetyGuidance: "Read-only.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.readVolumes(
            context.conversationId,
            arguments_,
          );
          logger.info("novel_publication_tool.volume.read.completed", {
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            volumeCount: details.volumes.length,
          });
          return formatReadToolResult(details, "Volumes read.");
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_VOLUME_READ_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelVolumeRead",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

export interface CreateChapterReadToolOptions {
  readonly service: NovelPublicationToolService;
  readonly logger?: Logger;
}

export function createChapterReadTool(
  options: CreateChapterReadToolOptions,
): RegisteredTool<typeof NovelChapterReadParametersSchema, NovelChapterReadDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_chapter_read_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelChapterRead",
      version: "1.0.0",
      label: "Novel Chapter Read",
      description:
        "Reads Chapters, optionally filtered by chapterId or volumeId. Returns each Chapter's ordered paragraphIds. Set includeContent=true to also return the joined content and expanded paragraphs in Chapter order.",
      parameters: NovelChapterReadParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Omit both filters for all Chapters. includeContent expands the selection into full text.",
        parameterGuidance:
          "chapterId and volumeId are mutually exclusive filters; includeContent defaults to false.",
        safetyGuidance: "Read-only.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.readChapters(
            context.conversationId,
            arguments_,
          );
          logger.info("novel_publication_tool.chapter.read.completed", {
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            chapterCount: details.chapters.length,
          });
          return formatReadToolResult(details, "Chapters read.");
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_CHAPTER_READ_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelChapterRead",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

