/**
 * ToolStrip
 *
 * 工具调用条（原型 .tool-strip + .tool-chip + .tool-rows）：按工具名聚合，
 * 点击 chip 展开每次调用的结果行（ok/failed + 阶段 + 耗时）。
 *
 * Tool-call strip: aggregates traces by tool name; clicking a chip expands the
 * per-call result rows (outcome + stage + duration).
 * memo 包裹 + groupTraces useMemo：traces 引用稳定即零重渲染。
 */
import { memo, useMemo, useState } from "react";
import type { ToolTraceView } from "../projection/ConversationTimelineItem.js";
import styles from "./ToolStrip.module.css";

export interface ToolStripProps {
  readonly traces: readonly ToolTraceView[];
}

interface ToolCallRow {
  readonly traceId: string;
  /** 终态结果（undefined = 进行中：tool-recorded.started 尚未收口） */
  readonly outcome?: "ok" | "failed";
  readonly durationMs?: number;
}

interface ToolGroup {
  toolName: string;
  calls: ToolCallRow[];
}

const TERMINAL_STAGES = new Set([
  "execution_completed",
  "execution_failed",
  "timed_out",
  "cancelled",
]);

function groupTraces(traces: readonly ToolTraceView[]): readonly ToolGroup[] {
  const rawByName = new Map<string, ToolTraceView[]>();
  for (const trace of traces) {
    const rows = rawByName.get(trace.toolName) ?? [];
    rows.push(trace);
    rawByName.set(trace.toolName, rows);
  }
  return [...rawByName.entries()].map(([toolName, traces]) => {
    const byTraceId = new Map<string, ToolTraceView[]>();
    for (const trace of traces) {
      const rows = byTraceId.get(trace.traceId) ?? [];
      rows.push(trace);
      byTraceId.set(trace.traceId, rows);
    }
    const calls: ToolCallRow[] = [...byTraceId.values()].map((rows) => {
      const terminal =
        rows.find((row) => row.stage !== undefined && TERMINAL_STAGES.has(row.stage)) ??
        rows[rows.length - 1]!;
      return {
        traceId: terminal.traceId,
        ...(terminal.outcome !== undefined ? { outcome: terminal.outcome } : {}),
        ...(terminal.durationMs === undefined
          ? {}
          : { durationMs: terminal.durationMs }),
      };
    });
    return { toolName, calls };
  });
}

/** 进行中的调用数（outcome 未收口） */
function runningCount(calls: readonly ToolCallRow[]): number {
  return calls.filter((call) => call.outcome === undefined).length;
}

/** outcome 行样式：undefined 用 muted 占位，终态按 ok/failed 上色 */
function outcomeClass(outcome: "ok" | "failed" | undefined): string | undefined {
  if (outcome === undefined) return styles.outcome;
  return [styles.outcome, outcome === "ok" ? styles.ok : styles.failed].join(" ");
}

export const ToolStrip = memo(function ToolStrip({ traces }: ToolStripProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = useMemo(() => groupTraces(traces), [traces]);
  if (traces.length === 0) return null;
  return (
    <section className={styles.strip}>
      <span className={styles.title}>
        工具调用
        <span className={styles.meta}>system.tool.trace.recorded · 同 label 聚合</span>
      </span>
      <div className={styles.chips}>
        {groups.map((group) => {
          const open = expanded === group.toolName;
          const failedCount = group.calls.filter(
            (call) => call.outcome === "failed",
          ).length;
          return (
            <div key={group.toolName} className={styles.group}>
              <button
                type="button"
                className={styles.chip}
                onClick={() => setExpanded(open ? null : group.toolName)}
                aria-expanded={open}
              >
                <span>{group.toolName}</span>
                <b>×{group.calls.length}</b>
                {failedCount > 0 ? <span className={styles.bad}>失败 {failedCount}</span> : null}
                {runningCount(group.calls) > 0 ? (
                  <span className={styles.running}>进行中 {runningCount(group.calls)}</span>
                ) : null}
                <span className={styles.chev}>{open ? "▾" : "›"}</span>
              </button>
              {open ? (
                <div className={styles.rows}>
                  {group.calls.map((call) => (
                    <div key={call.traceId} className={styles.row}>
                      <span className={outcomeClass(call.outcome)}>
                        {call.outcome === undefined ? "…" : call.outcome === "ok" ? "ok" : "failed"}
                      </span>
                      <span className={styles.txt}>{group.toolName}</span>
                      {call.outcome === undefined ? (
                        <span className={styles.running}>进行中</span>
                      ) : null}
                      {call.durationMs !== undefined ? (
                        <span className={styles.time}>{(call.durationMs / 1000).toFixed(1)}s</span>
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
});
