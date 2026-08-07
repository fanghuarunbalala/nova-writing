/** File Edit 工具：增量替换 design 文件（replace_all=false 替换第一个）。 */
/** File Edit tool: incremental replacement in the design file (first match unless replace_all). */
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
        "Replace an exact old_string in the current conversation's design file. replace_all=false replaces the first match; true replaces all. Legacy aliases old_str/new_str are accepted.",
      parameters: FileEditParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage: "Use Edit for small incremental changes to the design draft.",
        parameterGuidance:
          "old_string must appear in the file; provide enough context to match exactly once when replace_all=false.",
        safetyGuidance: "Only the current design file is editable; other paths are rejected.",
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
