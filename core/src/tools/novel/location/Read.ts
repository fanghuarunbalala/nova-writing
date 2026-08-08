/** NovelLocationRead tool: reads Location profiles for one explicit scope. */
import { noopLogger, type Logger } from "../../../observability/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
} from "../../../tooling/protocol/index.js";
import { formatReadToolResult } from "../readResult.js";
import {
  NovelLocationReadParametersSchema,
  type NovelLocationReadArguments,
  type NovelLocationReadDetails,
} from "./schemas.js";
import type { NovelLocationToolService } from "./ToolService.js";

export interface CreateLocationReadToolOptions {
  readonly service: NovelLocationToolService;
  readonly logger?: Logger;
}

export function createLocationReadTool(
  options: CreateLocationReadToolOptions,
): RegisteredTool<typeof NovelLocationReadParametersSchema, NovelLocationReadDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "novel_location_read_tool",
  });
  return defineTool({
    descriptor: {
      name: "NovelLocationRead",
      version: "1.0.0",
      label: "Novel Location Read",
      description:
        "Reads Location profiles for one explicit scope. Omit locationId to list all. The returned profile is the source for NovelLocationWrite and NovelLocationEdit values.",
      parameters: NovelLocationReadParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage:
          "Use scope=draft to preview uncommitted work or canonical for committed state.",
        parameterGuidance:
          "Omit locationId for the whole list; provide it to read one profile.",
        safetyGuidance: "Read-only.",
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
          logger.info("novel_location_tool.read.completed", {
            conversationId: context.conversationId,
            locationCount: details.locations.length,
          });
          return formatReadToolResult(details, "Locations read.");
        } catch (error) {
          if (error instanceof ToolError) throw error;
          throw new ToolError({
            code: "NOVEL_LOCATION_READ_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "NovelLocationRead",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

