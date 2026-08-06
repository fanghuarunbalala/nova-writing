/** NovelVolumeWrite and NovelChapterWrite tools: batch creation in the Draft. */
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
  NovelChapterWriteParametersSchema,
  NovelVolumeWriteParametersSchema,
  type NovelChapterWriteArguments,
  type NovelChapterWriteDetails,
  type NovelVolumeWriteArguments,
  type NovelVolumeWriteDetails,
} from "./schemas.js";
import type { NovelPublicationToolService } from "./ToolService.js";

export interface CreateVolumeWriteToolOptions {
  readonly service: NovelPublicationToolService;
  readonly logger?: Logger;
}

export function createVolumeWriteTool(
  options: CreateVolumeWriteToolOptions,
): RegisteredTool<typeof NovelVolumeWriteParametersSchema, NovelVolumeWriteDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_volume_write_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelVolumeWrite",
      version: "1.0.0",
      label: "Novel Volume Write",
      description:
        "Batch-creates Volumes in the conversation Draft. The publication root is auto-created on first write. id is optional; orderKey appends after the last Volume when omitted. Create fails with duplicate_id when the id already exists.",
      parameters: NovelVolumeWriteParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Omit id to let the host generate one. Use the returned id for NovelVolumeEdit.",
        parameterGuidance: "title is required; orderKey appends when omitted.",
        safetyGuidance: "Writes are Draft-only until NovelDraftCommit.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.writeVolumes(
            context.conversationId,
            arguments_,
          );
          logger.info("novel_publication_tool.volume.write.completed", {
            conversationId: context.conversationId,
            appliedCount: details.items.filter(
              (item) => item.status === "applied",
            ).length,
          });
          return writeResult(details, "Volumes written.");
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_VOLUME_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelVolumeWrite",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

export interface CreateChapterWriteToolOptions {
  readonly service: NovelPublicationToolService;
  readonly logger?: Logger;
}

export function createChapterWriteTool(
  options: CreateChapterWriteToolOptions,
): RegisteredTool<typeof NovelChapterWriteParametersSchema, NovelChapterWriteDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_chapter_write_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelChapterWrite",
      version: "1.0.0",
      label: "Novel Chapter Write",
      description:
        "Batch-creates Chapters in a Volume in the conversation Draft. id is optional; orderKey appends after the last Chapter in the Volume; paragraphIds defaults to an empty selection. Create fails with duplicate_id or unknown_volume.",
      parameters: NovelChapterWriteParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Create an empty Chapter first, then place content with NovelChapterEdit paragraphIds.",
        parameterGuidance:
          "volumeId is required; title defaults to 'Untitled Chapter'.",
        safetyGuidance: "Writes are Draft-only until NovelDraftCommit.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.writeChapters(
            context.conversationId,
            arguments_,
          );
          logger.info("novel_publication_tool.chapter.write.completed", {
            conversationId: context.conversationId,
            appliedCount: details.items.filter(
              (item) => item.status === "applied",
            ).length,
          });
          return writeResult(details, "Chapters written.");
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_CHAPTER_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelChapterWrite",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

function writeResult<T extends JsonValue>(
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
