import type { ToolCall } from "../provider/types.js";

/** 工具调度：按工具名分发到对应 handler 并执行（进程单例） */
export interface ToolDispatcher {
  /**
   * 分发执行一次工具调用
   * @param call 工具调用
   * @returns 执行结果文本
   */
  dispatch(call: ToolCall): Promise<string>;
}

/** ToolDispatcher 进程单例（进程启动时注册，AgentLoop 经 getToolDispatcher 访问） */
let toolDispatcherInstance: ToolDispatcher | undefined;

/**
 * 注册进程级 ToolDispatcher 单例
 * @param dispatcher 工具调度器
 */
export function setToolDispatcher(dispatcher: ToolDispatcher): void {
  toolDispatcherInstance = dispatcher;
}

/**
 * 获取进程级 ToolDispatcher 单例
 * @returns 工具调度器
 * @throws 未注册时抛出
 */
export function getToolDispatcher(): ToolDispatcher {
  if (!toolDispatcherInstance) {
    throw new Error("ToolDispatcher 尚未注册（进程启动时调用 setToolDispatcher）");
  }
  return toolDispatcherInstance;
}
