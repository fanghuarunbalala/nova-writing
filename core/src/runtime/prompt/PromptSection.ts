import type { ReadonlyLoopContext } from "../loop/LoopContext.js";

/** 系统提示词分段：统一 render 渲染；静态只渲染一次走缓存，动态每次 provider call 重新生成 */
export interface PromptSection {
  /** 分段类型：static 静态（缓存）/ dynamic 动态（每次渲染） */
  kind: "static" | "dynamic";
  /**
   * 渲染分段内容
   * @param ctx LoopContext 只读视图
   * @returns 分段文本
   */
  render(ctx: ReadonlyLoopContext): string;
}
