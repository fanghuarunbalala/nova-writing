/**
 * max_turn nudge（docs/PRD/max-turn-nudge.md v0.3）：
 * 轮次预算两级递进——warn（remaining <= warnWindow，预算将尽开始收尾）
 * + final（remaining <= 1 强提醒不调工具——把「最后一轮仍发 tool_call → 熔断抛异常」
 * 转化为 final 分支正常收口）。persistent append 通道、每 run 每级至多一次；
 * 同轮双门同时满足只注 final（escalation 塌缩，防单轮叠两条）。
 *
 * 口径：remaining = maxTurn - curTurn（含本轮——本轮响应即将发生）。
 * 生命周期：新 run（curTurn===0）或压缩纪元变化 / messages 非空→空 → 两级 injected
 * 复位；压缩链统一清扫带 nudge 标记的流内 system 消息（sweepNudgeMessages），
 * 清扫后窗口仍满足则各自重注一次。重启 seed-scan：仅扫当前 run（上一 run 的
 * 提醒不阻塞本 run），且首求值把纪元基线定为当前值——若基线从 0 起算，重启
 * 已压缩会话的 generation 失配会误复位 seed 置位的标志 → 提醒重发。
 * transient 通道不使用（恒 false）。
 */
import type { LoopContext } from "../../loop/LoopContext.js";
import type { RunProgress } from "../../loop/types.js";
import type { ProviderCall } from "../../provider/types.js";
import type { ContextNudgePolicy } from "../ContextNudgePolicy.js";

/** warn 级注入标记（压缩清扫/摘要过滤/seed-scan 识别用） */
export const MAX_TURN_NUDGE_MARK = "max_turn";

/** final 级注入标记（与 warn 分开，seed-scan 区分两级） */
export const MAX_TURN_FINAL_NUDGE_MARK = "max_turn_final";

/** warn 窗口阈值：剩余轮次（含本轮）<= 此值时注入 warn */
export const DEFAULT_WARN_WINDOW = 3;

/** 渲染 warn 级提醒全文（预算将尽，请开始收尾） */
export function renderMaxTurnText(curTurn: number, maxTurn: number): string {
  return [
    "# 轮次预算提醒",
    `本 run 已消耗 ${curTurn} 轮，剩余 ${maxTurn - curTurn} 轮（含本轮，总预算 ${maxTurn} 轮）。`,
    "请在剩余轮次内完成收尾：",
    "- 优先推进到可交付的结论：成稿正文 / 完成决议 / 给出明确下一步；",
    "- 若任务无法在预算内完成，明确交代已完成进度与剩余工作，不要静默中断。",
  ].join("\n");
}

/** 渲染 final 级提醒全文（最后一轮，禁止再调工具） */
export function renderMaxTurnFinalText(curTurn: number, maxTurn: number): string {
  return [
    "# 最后一轮提醒",
    `这是本 run 的最后一轮（第 ${curTurn + 1} 轮 / 共 ${maxTurn} 轮）：本轮之后预算耗尽。`,
    "不要再调用任何工具——后续工具调用将不会被处理，本次运行会以错误收场。",
    "立即给出最终回复：交付已完成的内容，并交代未完成部分与建议的下一步。",
  ].join("\n");
}

/** MaxTurnNudgePolicy 构造依赖 */
export interface MaxTurnNudgeDeps {
  /** warn 窗口阈值（剩余轮次 <= 此值注入 warn；缺省 3，测试注入用） */
  readonly warnWindow?: number;
}

/**
 * 轮次预算两级递进策略：persistent 每 run 每级一次；transient 不使用。
 * 零外部依赖——主 agent / BookAnalyst / 子代理（NovelSubagent catalog）通用。
 */
export class MaxTurnNudgePolicy implements ContextNudgePolicy {
  private readonly warnWindow: number;
  /** 本 run warn 级已注入（run 边界 / 纪元变化 / clear 复位） */
  private warnInjected = false;
  /** 本 run final 级已注入（同上复位） */
  private finalInjected = false;
  /** 首次求值 seed-scan + 纪元基线 latch 守卫（重启幂等） */
  private seeded = false;
  /** 上次观察的压缩代数（变化 = 纪元重置） */
  private lastCompactionGeneration = 0;
  /** 上次观察的 messages 数（非空→空 = clear 兜底） */
  private lastMessageCount = 0;

  constructor(deps: MaxTurnNudgeDeps = {}) {
    this.warnWindow = deps.warnWindow ?? DEFAULT_WARN_WINDOW;
  }

  /**
   * 持久注入：两级窗口判定（final 先于 warn——同轮双门只注 final）。
   */
  persistentNudgeIfNeeded(loop: LoopContext, run: RunProgress): boolean {
    const generation = loop.compactionGeneration;
    const messageCount = loop.messages.length;
    if (!this.seeded) {
      // 首求值（含重启恢复）：seed 当前 run 标记 + 纪元基线取当前值（见文件头说明）
      this.seeded = true;
      this.seedFromCurrentRun(loop);
    } else {
      const cleared = this.lastMessageCount > 0 && messageCount === 0;
      if (run.curTurn === 0 || generation !== this.lastCompactionGeneration || cleared) {
        this.warnInjected = false;
        this.finalInjected = false;
      }
    }
    this.lastCompactionGeneration = generation;
    this.lastMessageCount = messageCount;

    const remaining = run.maxTurn - run.curTurn;
    if (remaining <= 1 && !this.finalInjected) {
      this.finalInjected = true;
      loop.appendRunMessages([
        {
          role: "system",
          content: renderMaxTurnFinalText(run.curTurn, run.maxTurn),
          nudge: MAX_TURN_FINAL_NUDGE_MARK,
        },
      ]);
      return true;
    }
    if (remaining <= this.warnWindow && !this.warnInjected) {
      this.warnInjected = true;
      loop.appendRunMessages([
        {
          role: "system",
          content: renderMaxTurnText(run.curTurn, run.maxTurn),
          nudge: MAX_TURN_NUDGE_MARK,
        },
      ]);
      return true;
    }
    return false;
  }

  /** transient 通道不使用 */
  transientNudgeIfNeeded(
    _loop: LoopContext,
    _run: RunProgress,
    _call: ProviderCall,
  ): boolean {
    return false;
  }

  /** 首次求值：扫当前 run（runs 末尾）按标记分别置位（重启幂等，不重发） */
  private seedFromCurrentRun(loop: LoopContext): void {
    const currentRun = loop.runs[loop.runs.length - 1];
    for (const message of currentRun?.messages ?? []) {
      if (message.role !== "system") {
        continue;
      }
      if (message.nudge === MAX_TURN_NUDGE_MARK) {
        this.warnInjected = true;
      } else if (message.nudge === MAX_TURN_FINAL_NUDGE_MARK) {
        this.finalInjected = true;
      }
    }
  }
}
