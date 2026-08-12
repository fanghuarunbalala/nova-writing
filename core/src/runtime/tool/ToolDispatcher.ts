import type { ToolCall } from "../provider/types.js";
import type { ReadonlyLoopContext } from "../loop/LoopContext.js";

/** 工具调度：按工具名分发到对应 handler 并执行（由上层注入，非单例） */
export interface ToolDispatcher {
  /**
   * 分发执行一次工具调用（接收 LoopContext 只读视图）
   * @param ctx LoopContext 只读视图（工具可读上下文，不可修改）
   * @param call 工具调用
   * @returns 执行结果文本
   */
  dispatch(ctx: ReadonlyLoopContext, call: ToolCall): Promise<string>;
}
