/** File Glob 工具：在 workspace 沙盒内按模式找文件（相对路径，mtime 降序）。 */
/** File Glob tool: finds workspace files by pattern (workspace-relative paths, mtime descending). */
import { noopLogger, type Logger } from "../../observability/index.js";
import { ToolError } from "../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../tooling/protocol/index.js";
import {
  FileGlobParametersSchema,
  type FileGlobArguments,
} from "./schemas.js";
import {
  FileToolError,
  type FileGlobDetails,
  type FileToolService,
} from "./ToolService.js";
import { mapFileToolError } from "./toolError.js";

export interface CreateFileGlobToolOptions {
  readonly service: FileToolService;
  readonly logger?: Logger;
}

/** 构造 Glob 工具。Builds the Glob tool. */
export function createFileGlobTool(
  options: CreateFileGlobToolOptions,
): RegisteredTool<typeof FileGlobParametersSchema, FileGlobDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "file_glob_tool",
  });
  return defineTool({
    descriptor: {
      name: "Glob",
      version: "1.0.0",
      label: "File Glob",
      description:
        "Find files inside the workspace by glob pattern (e.g. **/*.md). Returns workspace-relative paths sorted by modification time, newest first.",
      parameters: FileGlobParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage: "Use Glob to discover workspace files before reading or editing them.",
        parameterGuidance:
          "Patterns are resolved against the workspace root; absolute patterns and parent traversal are rejected.",
        safetyGuidance: "Read-only; confined to the workspace sandbox.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.glob(arguments_.pattern);
          logger.info("file_tool.glob.completed", {
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            matchCount: details.matches.length,
          });
          return Object.freeze({
            content: Object.freeze([
              Object.freeze({
                type: "text" as const,
                text: `Found ${details.matches.length} match(es).`,
              }),
            ]),
            details,
          });
        } catch (error) {
          if (error instanceof ToolError) throw error;
          if (error instanceof FileToolError) {
            throw mapFileToolError(error, context, "Glob", "1.0.0");
          }
          throw new ToolError({
            code: "FILE_GLOB_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "Glob",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}
