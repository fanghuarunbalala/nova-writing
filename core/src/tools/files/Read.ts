/** File Read 工具：读取 workspace 沙盒内文件（可选行范围，cat -n 行号）。 */
/** File Read tool: reads a workspace file with an optional line window. */
import { noopLogger, type Logger } from "../../observability/index.js";
import { ToolError } from "../../runtime/tools/execution/index.js";
import {
  ToolPromptDetails,
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../tooling/protocol/index.js";
import {
  FileReadParametersSchema,
  type FileReadArguments,
} from "./schemas.js";
import {
  FileToolError,
  type FileReadDetails,
  type FileToolService,
} from "./ToolService.js";
import { mapFileToolError } from "./toolError.js";

export interface CreateFileReadToolOptions {
  readonly service: FileToolService;
  readonly logger?: Logger;
}

/** 构造 Read 工具。Builds the Read tool. */
export function createFileReadTool(
  options: CreateFileReadToolOptions,
): RegisteredTool<typeof FileReadParametersSchema, FileReadDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "file_read_tool",
  });
  return defineTool({
    descriptor: {
      name: "Read",
      version: "1.0.0",
      label: "File Read",
      description:
        "Read a file from the workspace directory using a workspace-relative path (e.g. .novel/design/draft.md). Results use cat -n format with line numbers starting at 1. Optionally provide a 0-indexed line offset and a positive limit.",
      parameters: FileReadParametersSchema,
      promptDetails: new ToolPromptDetails({
        usage: "Use Read to review files inside the workspace (e.g., the current design draft).",
        parameterGuidance:
          "file_path is required and must be workspace-relative; pass offset/limit to read a slice of a long file.",
        safetyGuidance: "Read-only; file_path must stay inside the workspace sandbox.",
      }),
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        try {
          const details = await options.service.read(
            arguments_.file_path,
            arguments_.offset ?? 0,
            arguments_.limit,
          );
          logger.info("file_tool.read.completed", {
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            sizeBytes: details.sizeBytes,
            totalLines: details.totalLines,
          });
          return readResult(details);
        } catch (error) {
          if (error instanceof ToolError) throw error;
          if (error instanceof FileToolError) {
            throw mapFileToolError(error, context, "Read", "1.0.0");
          }
          throw new ToolError({
            code: "FILE_READ_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "Read",
            toolVersion: "1.0.0",
          });
        }
      },
    },
  });
}

/** cat -n 行号文本 + 结构化 details。Line-numbered text plus structured details. */
function readResult(details: FileReadDetails): ToolResult<FileReadDetails> {
  const numbered = details.content
    .split("\n")
    .map((line, index) => `${index + 1}\t${line}`)
    .join("\n");
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: numbered }),
    ]),
    details,
  });
}
