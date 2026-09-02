import type { ToolCall } from "../provider/types.js";
import type { ReadonlyLoopContext } from "../loop/LoopContext.js";
import type { ToolDef } from "./ToolDef.js";

/** 工具调度：按工具名分发到对应 handler 并执行（由上层注入，非单例） */
export interface ToolDispatcher {
  /**
   * 分发执行一次工具调用（接收 LoopContext 只读视图）
   * @param ctx LoopContext 只读视图（工具可读上下文，不可修改）
   * @param call 工具调用
   * @returns 执行结果文本
   */
  dispatch(ctx: ReadonlyLoopContext, call: ToolCall): Promise<string>;
  /**
   * 按工具名解析工具定义（Map 查表；审批门控等调用面用）
   * @param name 工具名
   * @returns 工具定义；未注册返回 undefined
   */
  resolve(name: string): ToolDef | undefined;
}
