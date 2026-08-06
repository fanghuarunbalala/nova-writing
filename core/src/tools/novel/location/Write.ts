/** NovelLocationWrite tool: batch-creates Location profiles in the Draft. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../../tooling/protocol/index.js";
import {
  NovelLocationWriteParametersSchema,
  type NovelLocationWriteArguments,
  type NovelLocationWriteDetails,
} from "./schemas.js";
import type { NovelLocationToolService } from "./ToolService.js";

export interface CreateLocationWriteToolOptions {
  readonly service: NovelLocationToolService;
  readonly logger?: Logger;
}

export function createLocationWriteTool(
  options: CreateLocationWriteToolOptions,
): RegisteredTool<typeof NovelLocationWriteParametersSchema, NovelLocationWriteDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_location_write_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelLocationWrite",
      version: "1.0.0",
      label: "Novel Location Write",
      description:
        "Batch-creates Location profiles in the conversation Draft. id is optional; when omitted the host generates and returns it. Create fails with duplicate_id when the id already exists. Items apply in order; the batch stops at the first rejected item.",
      parameters: NovelLocationWriteParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Omit id to let the host generate one. Use the returned id for later NovelLocationEdit calls.",
        parameterGuidance:
          "name is required and aliases may be empty. summary/initialState/authorNotes are optional.",
        safetyGuidance: "Writes are Draft-only until NovelDraftCommit.",
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
          logger.info("novel_location_tool.write.completed", {
            conversationId: context.conversationId,
            appliedCount: details.items.filter(
              (item) => item.status === "appended",
            ).length,
          });
          return writeResult(details);
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_LOCATION_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelLocationWrite",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

function writeResult(
  details: NovelLocationWriteDetails,
): ToolResult<NovelLocationWriteDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: "Locations written." }),
    ]),
    details,
  });
}
