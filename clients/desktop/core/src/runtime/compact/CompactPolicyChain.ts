import type { LoopContext } from "../loop/LoopContext.js";
import type { ContextCompactPolicy } from "./ContextCompactPolicy.js";

/** 压缩策略链：多个策略按优先级注册，链式逐个执行（compact 保留链，nudge 为数组遍历） */
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
   * 链式检查并压缩（策略按优先级逐个 shouldCompact → compact；策略可含 LLM 调用，故为异步）
   * @param loop LoopContext（策略直接操作上下文）
   * @returns 是否有策略执行了压缩
   */
  compactIfNeeded(loop: LoopContext): Promise<boolean>;
  /**
   * 强制压缩（跳过 shouldCompact 阈值门，逐策略直接 compact；超窗保险丝用）
   * @param loop LoopContext（策略直接操作上下文）
   * @returns 是否有策略实际压缩了
   */
  compactAll(loop: LoopContext): Promise<boolean>;
}
