/** File Write 工具：整文件原子写入 design 文件。 */
/** File Write tool: atomic full-file write to the design file. */
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
        "Write full content to the current conversation's design file. Only the design file is writable during compose mode.",
      parameters: FileWriteParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage: "Use Write to replace the whole design draft with new content.",
        parameterGuidance:
          "file_path must be the current conversation's design file; content is written atomically.",
        safetyGuidance: "Only the current design file is writable; other paths are rejected.",
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
