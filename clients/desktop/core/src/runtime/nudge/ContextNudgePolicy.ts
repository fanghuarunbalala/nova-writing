import type { LoopContext } from "../loop/LoopContext.js";
import type { RunProgress } from "../loop/types.js";
import type { ProviderCall } from "../provider/types.js";

/** 提示注入策略：两种模式——持久追加（appendRunMessages）/ 瞬时插入（改 ProviderCall），直接操作上下文 */
export interface ContextNudgePolicy {
  /**
   * 持久提示注入：调 loop.appendRunMessages 追加到当前 run 末尾（持久化）。
   * 可返回 Promise（实现需异步查询外部状态时，如 novel-db；调用方 await——
   * 求值先于消息快照，本 call 即可见）
   * @param loop LoopContext
   * @param run 当前 run 运行状态（curTurn / maxTurn / 工具使用记录）
   * @returns 是否注入了
   */
  persistentNudgeIfNeeded(loop: LoopContext, run: RunProgress): boolean | Promise<boolean>;
  /**
   * 瞬时提示注入：每次 provider call 前调用，直接插入 ProviderCall 特定位置（不持久化）。
   * 可返回 Promise（实现需异步查询外部状态时，如 novel-db；调用方 await）
   * @param loop LoopContext
   * @param run 当前 run 运行状态
   * @param call ProviderCall（原地修改：插入 system / messages 特定位置）
   * @returns 是否注入了
   */
  transientNudgeIfNeeded(
    loop: LoopContext,
    run: RunProgress,
    call: ProviderCall,
  ): boolean | Promise<boolean>;
}
