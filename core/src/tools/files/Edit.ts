/** File Edit 工具：增量替换 workspace 沙盒内文件（replace_all=false 替换第一个）。 */
/** File Edit tool: incremental replacement in a workspace file (first match unless replace_all). */
import { noopLogger, type Logger } from "../../observability/index.js";
import { ToolError } from "../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../tooling/protocol/index.js";
import {
  FileEditParametersSchema,
  type FileEditArguments,
} from "./schemas.js";
import {
  FileToolError,
  type FileEditDetails,
  type FileToolService,
} from "./ToolService.js";
import { mapFileToolError } from "./toolError.js";

export interface CreateFileEditToolOptions {
  readonly service: FileToolService;
  readonly logger?: Logger;
}

/** 构造 Edit 工具。Builds the Edit tool. */
export function createFileEditTool(
  options: CreateFileEditToolOptions,
): RegisteredTool<typeof FileEditParametersSchema, FileEditDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "file_edit_tool",
  });
  return defineTool({
    descriptor: {
      name: "Edit",
      version: "1.0.0",
      label: "File Edit",
      description:
        "在 workspace 目录内的文件中做精确字符串替换，使用 workspace 相对路径。\n\n用法：\n- file_path 必须指向 workspace 内的已有文件；文件不存在会被拒绝。\n- old_string 必须出现在文件中；未命中会报错并提示提供更多上下文。\n- replace_all=false（默认）只替换第一处；replace_all=true 替换全部。\n- 整体重写请用 Write 工具；编辑不熟悉的内容前建议先用 Read 查看。\n- 结果内容不得超过 512 KiB。\n- 路径限定在 workspace 沙盒内；绝对路径、父目录穿越、符号链接逃逸都会被拒绝。",
      parameters: FileEditParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage: "Use Edit for small incremental changes to a workspace file (e.g., the design draft).",
        parameterGuidance:
          "file_path must be a workspace-relative path; old_string must appear in the file; provide enough context to match exactly once when replace_all=false.",
        safetyGuidance: "Edits outside the workspace sandbox are rejected.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.edit(
            arguments_.file_path,
            arguments_.old_string,
            arguments_.new_string,
            arguments_.replace_all ?? false,
          );
          logger.info("file_tool.edit.completed", {
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            sizeBytes: details.sizeBytes,
          });
          return Object.freeze({
            content: Object.freeze([
              Object.freeze({ type: "text" as const, text: "File edited." }),
            ]),
            details,
          });
        } catch (error) {
          if (error instanceof ToolError) throw error;
          if (error instanceof FileToolError) {
            throw mapFileToolError(error, context, "Edit", "1.0.0");
          }
          throw new ToolError({
            code: "FILE_EDIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "Edit",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}
