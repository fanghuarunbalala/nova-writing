import type { LoopContext } from "../loop/LoopContext.js";
import type { RunContext } from "../loop/types.js";
import type { ProviderCall } from "../provider/types.js";

/** 提示注入策略：两种模式——持久追加（appendTurnMessages）/ 瞬时插入（改 ProviderCall），直接操作上下文 */
export interface ContextNudgePolicy {
  /**
   * 持久提示注入：调 loop.appendTurnMessages 追加到当前 turn 末尾（持久化）
   * @param loop LoopContext
   * @param run 当前 run 运行状态（curTurn / maxTurn / 工具使用记录）
   * @returns 是否注入了
   */
  persistentNudgeIfNeeded(loop: LoopContext, run: RunContext): boolean;
  /**
   * 瞬时提示注入：每次 provider call 前调用，直接插入 ProviderCall 特定位置（不持久化）
   * @param loop LoopContext
   * @param run 当前 run 运行状态
   * @param call ProviderCall（原地修改：插入 system / messages 特定位置）
   * @returns 是否注入了
   */
  transientNudgeIfNeeded(loop: LoopContext, run: RunContext, call: ProviderCall): boolean;
}
