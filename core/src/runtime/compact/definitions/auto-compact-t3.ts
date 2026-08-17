/**
 * T3 硬丢弃（docs/PRD/context-compact.md §6）：危险线（est ≥ window − maxOutput/2）
 * 时从最老开始整 run 丢弃（含旧摘要 run），首 run（作者意图）最后丢；逐 run 丢弃
 * 并重估算。正常会话不应到达——承认信息损失的最后手段，每次丢弃写结构化日志。
 */
import type { LoopContext } from "../../loop/LoopContext.js";
import type { RunContext } from "../../loop/types.js";
import type { AutoCompactConfig } from "./auto-compact-shared.js";
import { measure } from "./auto-compact-analyze.js";

/** 危险线硬丢弃；返回是否发生丢弃 */
export function hardDrop(loop: LoopContext, cfg: AutoCompactConfig): boolean {
  let m = measure(loop, cfg);
  if (m.window === undefined || m.est < m.t3) return false;
  const runs = loop.runs;
  // 丢弃顺序：压缩区（时序最老在前，含摘要 run）→ 首 run 兜底
  const candidates: RunContext[] = runs.slice(
    cfg.keepFirst,
    Math.max(cfg.keepFirst, runs.length - cfg.keepLast),
  );
  const firstRun = runs[0];
  if (firstRun !== undefined && runs.length > cfg.keepLast) candidates.push(firstRun);
  let dropped = false;
  for (const run of candidates) {
    if (m.est < m.t3) break;
    const idx = runs.indexOf(run);
    if (idx < 0) continue;
    runs.splice(idx, 1);
    dropped = true;
    cfg.logger?.warn("compact.t3.dropped", { seq: run.seq });
    m = measure(loop, cfg);
  }
  return dropped;
}
