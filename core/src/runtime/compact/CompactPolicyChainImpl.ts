import type { LoopContext } from "../loop/LoopContext.js";
import type { ContextCompactPolicy } from "./ContextCompactPolicy.js";
import type { CompactPolicyChain } from "./CompactPolicyChain.js";

/** 压缩策略链实现：按优先级降序存储，链式短路执行 */
export class CompactPolicyChainImpl implements CompactPolicyChain {
  /** 已注册策略（按优先级降序） */
  private policies: { policy: ContextCompactPolicy; priority: number }[] = [];

  /**
   * 注册压缩策略（按优先级降序插入）
   * @param policy 压缩策略
   * @param priority 优先级（大者先执行）
   */
  register(policy: ContextCompactPolicy, priority: number): void {
    this.policies.push({ policy, priority });
    this.policies.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 注销压缩策略
   * @param policy 压缩策略
   */
  unregister(policy: ContextCompactPolicy): void {
    this.policies = this.policies.filter((p) => p.policy !== policy);
  }

  /**
   * 链式检查并压缩（按优先级逐个 shouldCompact → compact，任一实际压缩即短路返回）
   * @param loop LoopContext（策略直接操作上下文）
   * @returns 是否有策略执行了压缩
   */
  compactIfNeeded(loop: LoopContext): boolean {
    for (const { policy } of this.policies) {
      if (policy.shouldCompact(loop)) {
        if (policy.compact(loop)) {
          return true;
        }
      }
    }
    return false;
  }
}
