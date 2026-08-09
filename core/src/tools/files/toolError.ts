/** 文件工具错误映射：FileToolError -> ToolError（路径类=permission，其余=execution）。 */
/** File tool error mapping: FileToolError -> ToolError (path-class to permission; others to execution). */
import { ToolError } from "../../runtime/tools/execution/index.js";
import { FILE_TOOL_ERROR_CODE, FileToolError } from "./ToolService.js";

export function mapFileToolError(
  error: FileToolError,
  context: { conversationId: string; runId: string; toolCallId: string },
  toolName: string,
  toolVersion: string,
): ToolError {
  const category =
    error.code === FILE_TOOL_ERROR_CODE.pathForbidden ? "permission" : "execution";
  return new ToolError({
    code: error.code,
    category,
    retryable: false,
    sideEffectStatus: "none",
    conversationId: context.conversationId,
    runId: context.runId,
    toolCallId: context.toolCallId,
    toolName,
    toolVersion,
  });
}
