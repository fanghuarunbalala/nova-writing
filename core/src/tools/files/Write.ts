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
        "将完整内容写入 workspace 目录内的文件，使用 workspace 相对路径（如 .novel/design/draft.md）。\n\n用法：\n- 若目标路径已有文件，本工具会整体覆盖。\n- 只用于新建文件或整体重写文件；对已有文件的小改动，优先用 Edit 工具（只发送差异）。\n- 写入是原子的（先写临时文件再重命名）；缺失的父目录会自动创建。\n- file_path 必须是 workspace 相对路径，不能是绝对路径。\n- 内容超过 512 KiB 会被拒绝。\n- 路径限定在 workspace 沙盒内；绝对路径、父目录穿越、符号链接逃逸都会被拒绝。",
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
