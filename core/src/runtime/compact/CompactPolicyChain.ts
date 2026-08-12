import type { TurnContext } from "../loop/types.js";
import type { ContextCompactPolicy } from "./ContextCompactPolicy.js";

/** 压缩策略链：多个策略按优先级注册，链式逐个执行 */
export interface CompactPolicyChain {
  /**
   * 注册压缩策略
   * @param policy 压缩策略
   * @param priority 优先级（大者先执行）
   */
  register(policy: ContextCompactPolicy, priority: number): void;
  /**
   * 注销压缩策略
   * @param policy 压缩策略
   */
  unregister(policy: ContextCompactPolicy): void;
  /**
   * 链式检查并压缩（策略按优先级逐个 shouldCompact → compact）
   * @param turnContexts 当前 turn 序列
   * @returns 是否有策略执行了压缩
   */
  compactIfNeeded(turnContexts: TurnContext[]): boolean;
}
