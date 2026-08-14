import type { LoopContext } from "../loop/LoopContext.js";

/** 上下文压缩策略：依据 LoopContext 判定 + 执行压缩（直接操作上下文） */
export interface ContextCompactPolicy {
  /**
   * 是否需要压缩
   * @param loop LoopContext（看 runs 内容：大小 / 消息数）
   * @returns 是否需要压缩
   */
  shouldCompact(loop: LoopContext): boolean;
  /**
   * 执行压缩（修改 loop 的 runs）
   * @param loop LoopContext
   * @returns 是否实际压缩了
   */
  compact(loop: LoopContext): boolean;
}
