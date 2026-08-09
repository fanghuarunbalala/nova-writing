/** File Write 工具：整文件原子写入 workspace 沙盒内文件。 */
/** File Write tool: atomic full-file write to a file inside the workspace sandbox. */
import { noopLogger, type Logger } from "../../observability/index.js";
import { ToolError } from "../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../tooling/protocol/index.js";
import {
  FileWriteParametersSchema,
  type FileWriteArguments,
} from "./schemas.js";
import {
  FileToolError,
  type FileToolService,
  type FileWriteDetails,
} from "./ToolService.js";
import { mapFileToolError } from "./toolError.js";

export interface CreateFileWriteToolOptions {
  readonly service: FileToolService;
  readonly logger?: Logger;
}

/** 构造 Write 工具。Builds the Write tool. */
export function createFileWriteTool(
  options: CreateFileWriteToolOptions,
): RegisteredTool<typeof FileWriteParametersSchema, FileWriteDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "file_write_tool",
  });
  return defineTool({
    descriptor: {
      name: "Write",
      version: "1.0.0",
      label: "File Write",
      description:
        "Write full content to a file inside the workspace directory using a workspace-relative path (e.g. .novel/design/draft.md). Any path within the workspace sandbox is writable.",
      parameters: FileWriteParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage: "Use Write to replace a whole workspace file (e.g., the design draft) with new content.",
        parameterGuidance:
          "file_path must be a workspace-relative path inside the workspace sandbox; content is written atomically.",
        safetyGuidance: "Writes outside the workspace sandbox are rejected.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.write(
            arguments_.file_path,
            arguments_.content,
          );
          logger.info("file_tool.write.completed", {
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            sizeBytes: details.sizeBytes,
          });
          return Object.freeze({
            content: Object.freeze([
              Object.freeze({ type: "text" as const, text: "File written." }),
            ]),
            details,
          });
        } catch (error) {
          if (error instanceof ToolError) throw error;
          if (error instanceof FileToolError) {
            throw mapFileToolError(error, context, "Write", "1.0.0");
          }
          throw new ToolError({
            code: "FILE_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "Write",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}
