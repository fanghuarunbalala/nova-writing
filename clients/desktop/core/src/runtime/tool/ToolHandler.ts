import type { ToolCall } from "../provider/types.js";

/** 工具实现：真正执行一次调用 */
export interface ToolHandler {
  /**
   * 执行一次工具调用
   * @param call 工具调用（含 id / name / args）
   * @returns 执行结果文本
   */
  execute(call: ToolCall): Promise<string>;
}
