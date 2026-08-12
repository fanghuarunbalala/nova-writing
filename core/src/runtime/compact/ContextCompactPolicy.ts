import type { RunContext } from "../loop/types.js";

/** 上下文压缩策略：单一压缩判定 + 执行 */
export interface ContextCompactPolicy {
  /**
   * 是否需要压缩
   * @param runContexts 当前回合序列
   * @returns 是否需要压缩
   */
  shouldCompact(runContexts: RunContext[]): boolean;
  /**
   * 执行压缩
   * @param runContexts 当前回合序列
   * @returns 是否实际压缩了
   */
  compact(runContexts: RunContext[]): boolean;
}
