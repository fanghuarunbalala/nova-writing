import type { TurnContext } from "../loop/types.js";

/** 上下文压缩策略：单一压缩判定 + 执行 */
export interface ContextCompactPolicy {
  /**
   * 是否需要压缩
   * @param turnContexts 当前 turn 序列
   * @returns 是否需要压缩
   */
  shouldCompact(turnContexts: TurnContext[]): boolean;
  /**
   * 执行压缩
   * @param turnContexts 当前 turn 序列
   * @returns 是否实际压缩了
   */
  compact(turnContexts: TurnContext[]): boolean;
}
