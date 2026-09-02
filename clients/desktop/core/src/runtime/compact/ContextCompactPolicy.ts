import type { LoopContext } from "../loop/LoopContext.js";

/** 上下文压缩策略：依据 LoopContext 判定 + 执行压缩（直接操作上下文） */
export interface ContextCompactPolicy {
  /**
   * 是否需要压缩
   * @param loop LoopContext（看 runs 内容：大小 / 消息数 / 最近 token 用量）
   * @returns 是否需要压缩
   */
  shouldCompact(loop: LoopContext): boolean;
  /**
   * 执行压缩（修改 loop 的 runs；可包含 LLM 摘要调用，故为异步）
   * @param loop LoopContext
   * @param opts 附加选项（force=true 跳过内部阈值门做最大力度压缩——超窗保险丝路径）
   * @returns 是否实际压缩了
   */
  compact(loop: LoopContext, opts?: { force?: boolean }): Promise<boolean>;
}
