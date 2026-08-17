/**
 * 自动上下文压缩策略（docs/PRD/context-compact.md）：三道门禁顺序判定，
 * 单次 compact 内 T1 结构化骨架化 → T2 逐段摘要折叠 → T3 硬丢弃收敛。
 *
 * 本文件是编排壳（对 CompactPolicyChain 暴露为单一策略——三道门禁共享度量与
 * 顺序依赖，不是可互相替代的独立策略；链机制保留给未来的独立策略如 Snip）：
 * - auto-compact-shared：常量与类型（阈值/占位标记/配置）
 * - auto-compact-analyze：度量（measure）、分区（zoneOf）、novel 域扫描、字符估算
 * - auto-compact-t1 / -t2 / -t3：三道门禁的实现
 *
 * - 阈值信号：最近一次 provider 回报的 inputTokens（RunContext.lastInputTokens）；
 *   压缩后按字符比例重估（见 analyze.measure）
 * - T1（≥70%·window，零成本）：压缩区骨架化——通用长度规则 + novel 域规则
 *   （同实体多次写只保留最后一次调用记录；后写覆盖前读）
 * - T2（≥ window−maxOutput−余量，≤92%）：折叠最老未摘要段为一条摘要 run（一次一段；
 *   摘要 run 只增不并、永不再摘要——防信息失真）
 * - T3（≥ window−maxOutput/2）：从最老开始硬丢弃整 run（含旧摘要 run；首 run 最后丢）
 * - 协议约束：tool result 只替换不删除（与 toolCall 按 id 配对，防 provider 400）
 */
import type { LoopContext } from "../../loop/LoopContext.js";
import type { ContextCompactPolicy } from "../ContextCompactPolicy.js";
import type { Provider } from "../../provider/Provider.js";
import type { Logger } from "../../../log/Logger.js";
import { WINDOW_FALLBACK, type AutoCompactConfig, type Measure } from "./auto-compact-shared.js";
import {
  countRunChars,
  estimateTokens,
  isSummaryRun,
  measure,
  messagesChars,
  parseNovelCall,
  scanNovelMeta,
  zoneOf,
} from "./auto-compact-analyze.js";
import { skeletonize, structuralWorkCount } from "./auto-compact-t1.js";
import { foldSummaries } from "./auto-compact-t2.js";
import { hardDrop } from "./auto-compact-t3.js";

// 兼容 re-export：调用方（AgentLoop 的 countRunChars、单测的 parseNovelCall 等）
// 统一从本文件取用，模块内部拆分不外溢
export { countRunChars, estimateTokens, messagesChars, parseNovelCall };

/** 策略构造选项（缺省值见各项注释） */
export interface AutoCompactOptions {
  /** T1 触发比例（缺省 0.7） */
  t1Ratio?: number;
  /** T2 余量 token（缺省 12000）：T2 线 = window − maxOutput − 余量 */
  t2MarginTokens?: number;
  /** T2 线上限比例（缺省 0.92） */
  t2CapRatio?: number;
  /** 摘要段输入 token 预算（缺省 40000；每次触发折一段） */
  summarySegmentTokens?: number;
  /** 摘要输出上限 token（缺省 2048） */
  summaryMaxTokens?: number;
  /** 保留首部 run 数（缺省 1：作者意图） */
  keepFirst?: number;
  /** 保留尾部 run 数（缺省 3；执行中 run 恒在其中） */
  keepLast?: number;
  /** 窗口查询（缺省经 provider.getModelInfo；查不到兜底 128k） */
  windowTokensOf?: (model: string) => number;
  /** 结构化日志（可选） */
  logger?: Logger;
}

/**
 * 自动上下文压缩策略（主 agent 装配；见文件头注释）
 */
export class AutoCompactPolicy implements ContextCompactPolicy {
  private readonly cfg: AutoCompactConfig;

  constructor(provider: Provider, opts: AutoCompactOptions = {}) {
    this.cfg = {
      provider,
      t1Ratio: opts.t1Ratio ?? 0.7,
      t2MarginTokens: opts.t2MarginTokens ?? 12_000,
      t2CapRatio: opts.t2CapRatio ?? 0.92,
      summarySegmentTokens: opts.summarySegmentTokens ?? 40_000,
      summaryMaxTokens: opts.summaryMaxTokens ?? 2_048,
      keepFirst: opts.keepFirst ?? 1,
      keepLast: opts.keepLast ?? 3,
      windowTokensOf:
        opts.windowTokensOf ??
        ((model) => {
          const info = provider.getModelInfo(model);
          return info.contextWindowTokens ?? WINDOW_FALLBACK;
        }),
      logger: opts.logger,
    };
  }

  /** 是否需要压缩：阈值已到且仍有可做的工作（T1 可剪 / T2 可折 / T3 可丢） */
  shouldCompact(loop: LoopContext): boolean {
    const m = measure(loop, this.cfg);
    if (m.window === undefined) {
      this.cfg.logger?.debug("compact.evaluated", { decision: "no_signal", runs: loop.runs.length });
      return false;
    }
    if (m.est < m.t1) {
      this.cfg.logger?.debug("compact.evaluated", {
        decision: "below_t1",
        est: m.est,
        t1: m.t1,
        runs: loop.runs.length,
      });
      return false;
    }
    const work = this.hasWork(loop, m);
    this.cfg.logger?.debug("compact.evaluated", {
      decision: work ? "trigger" : "no_work",
      model: m.model,
      est: m.est,
      t1: m.t1,
      t2: m.t2,
      t3: m.t3,
      runs: loop.runs.length,
    });
    return work;
  }

  /**
   * 执行压缩：T1 → T2 → T3 顺序（每级动作后重估算）。
   * force 模式（保险丝）跳过 T1 阈值门且 T2 可连续折叠多段。
   * @returns 是否有任何一级实际压缩
   */
  async compact(loop: LoopContext, opts?: { force?: boolean }): Promise<boolean> {
    const force = opts?.force === true;
    const m = measure(loop, this.cfg);
    if (m.window === undefined) return false;
    if (!force && m.est < m.t1) return false;

    // 触发日志：本次压缩的完整决策快照（谁触发 / 窗口多大 / 估算多少 / 三线在哪）
    this.cfg.logger?.info("compact.trigger", {
      force,
      model: m.model,
      window: m.window,
      est: m.est,
      t1: m.t1,
      t2: m.t2,
      t3: m.t3,
      runs: loop.runs.length,
    });

    let changed = false;
    // T1 结构化骨架化（压缩区；force 时也照常执行）
    const zoneRuns = zoneOf(loop.runs, this.cfg.keepFirst, this.cfg.keepLast);
    if (zoneRuns !== undefined && zoneRuns.length > 0) {
      const meta = scanNovelMeta(loop.runs, this.cfg.keepFirst);
      if (skeletonize(zoneRuns, meta)) {
        changed = true;
        this.cfg.logger?.info("compact.t1.skeletonized", {
          runs: zoneRuns.length,
          estAfter: measure(loop, this.cfg).est,
        });
      }
    }
    // T2 逐段摘要折叠（内部按 T2 线判断；常规一次一段）
    if (await foldSummaries(loop, this.cfg, force)) changed = true;
    // T3 硬丢弃（危险线；从最老开始，首 run 最后）
    if (hardDrop(loop, this.cfg)) changed = true;
    this.cfg.logger?.info("compact.done", {
      changed,
      estAfter: measure(loop, this.cfg).est,
      runsAfter: loop.runs.length,
    });
    return changed;
  }

  /** 是否仍有可做的工作（shouldCompact 判定；全部同步检查） */
  private hasWork(loop: LoopContext, m: Measure): boolean {
    const runs = loop.runs;
    if (runs.length <= this.cfg.keepFirst + this.cfg.keepLast) return false;
    if (m.est >= m.t3) return true;
    const zone = zoneOf(runs, this.cfg.keepFirst, this.cfg.keepLast);
    if (m.est >= m.t2 && zone !== undefined && zone.some((r) => !isSummaryRun(r))) return true;
    const meta = scanNovelMeta(runs, this.cfg.keepFirst);
    return structuralWorkCount(zone ?? [], meta) > 0;
  }
}
