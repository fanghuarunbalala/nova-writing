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
   * 链式检查是否需要压缩（只判定不执行；PRD memory-两层记忆 M4：压缩前提取
   * 整理 pass 用——「判定通过、T1 前」的钩子需要先知道会不会压缩）
   * @param loop LoopContext（策略直接读取上下文）
   * @returns 任一策略 shouldCompact 即 true
   */
  needsCompact(loop: LoopContext): boolean {
    for (const { policy } of this.policies) {
      if (policy.shouldCompact(loop)) return true;
    }
    return false;
  }

  /**
   * 链式检查并压缩（按优先级逐个 shouldCompact → compact，任一实际压缩即短路返回；
   * 策略可含 LLM 摘要调用，故为异步）
   * @param loop LoopContext（策略直接操作上下文）
   * @returns 是否有策略执行了压缩
   */
  async compactIfNeeded(loop: LoopContext): Promise<boolean> {
    for (const { policy } of this.policies) {
      if (policy.shouldCompact(loop)) {
        if (await policy.compact(loop)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 强制压缩（跳过 shouldCompact 阈值门，逐策略以 force 模式 compact；超窗保险丝用）
   * @param loop LoopContext（策略直接操作上下文）
   * @returns 是否有策略实际压缩了
   */
  async compactAll(loop: LoopContext): Promise<boolean> {
    let compacted = false;
    for (const { policy } of this.policies) {
      if (await policy.compact(loop, { force: true })) {
        compacted = true;
      }
    }
    return compacted;
  }
}
