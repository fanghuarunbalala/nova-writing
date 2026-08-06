/**
 * ToolStrip
 *
 * 工具调用条（原型 .tool-strip + .tool-chip + .tool-rows）：按工具名聚合，
 * 点击 chip 展开每次调用的结果行（ok/failed + 阶段 + 耗时）。
 *
 * Tool-call strip: aggregates traces by tool name; clicking a chip expands the
 * per-call result rows (outcome + stage + duration).
 */
import { useState } from "react";
import type { ToolTraceView } from "../projection/ConversationTimelineItem.js";
import styles from "./ToolStrip.module.css";

export interface ToolStripProps {
  readonly traces: readonly ToolTraceView[];
}

interface ToolGroup {
  toolName: string;
  total: number;
  ok: number;
  failed: number;
  traces: ToolTraceView[];
}

function groupTraces(traces: readonly ToolTraceView[]): readonly ToolGroup[] {
  const byName = new Map<string, ToolGroup>();
  for (const trace of traces) {
    const group = byName.get(trace.toolName) ?? {
      toolName: trace.toolName,
      total: 0,
      ok: 0,
      failed: 0,
      traces: [],
    };
    group.total += 1;
    if (trace.outcome === "ok") group.ok += 1;
    else group.failed += 1;
    group.traces = [...group.traces, trace];
    byName.set(trace.toolName, group);
  }
  return [...byName.values()];
}

export function ToolStrip({ traces }: ToolStripProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (traces.length === 0) return null;
  const groups = groupTraces(traces);
  return (
    <section className={styles.strip}>
      <span className={styles.title}>
        工具调用
        <span className={styles.meta}>system.tool.trace.recorded · 同 label 聚合</span>
      </span>
      <div className={styles.chips}>
        {groups.map((group) => {
          const open = expanded === group.toolName;
          return (
            <div key={group.toolName} className={styles.group}>
              <button
                type="button"
                className={styles.chip}
                onClick={() => setExpanded(open ? null : group.toolName)}
                aria-expanded={open}
              >
                <span>{group.toolName}</span>
                <b>×{group.total}</b>
                {group.failed > 0 ? <span className={styles.bad}>失败 {group.failed}</span> : null}
                <span className={styles.chev}>{open ? "▾" : "›"}</span>
              </button>
              {open ? (
                <div className={styles.rows}>
                  {group.traces.map((trace) => (
                    <div key={trace.traceId} className={styles.row}>
                      <span className={[styles.outcome, trace.outcome === "ok" ? styles.ok : styles.failed].join(" ")}>
                        {trace.outcome === "ok" ? "ok" : "failed"}
                      </span>
                      <span className={styles.txt}>
                        {trace.toolName}
                        {trace.stage !== undefined ? ` · ${trace.stage}` : ""}
                      </span>
                      {trace.durationMs !== undefined ? (
                        <span className={styles.time}>{(trace.durationMs / 1000).toFixed(1)}s</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
