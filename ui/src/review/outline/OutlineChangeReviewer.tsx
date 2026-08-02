/** Collapsible tree Diff reviewer with explicit add/delete/modify/move semantics. */
import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  captureOutlineTreeDiffView,
  type OutlineTreeDiffKind,
  type OutlineTreeDiffRowView,
  type OutlineTreeDiffView,
} from "./OutlineTreeDiffView.js";

export function OutlineChangeReviewer({ view: input }: { readonly view: OutlineTreeDiffView }) {
  const view = useMemo(() => captureOutlineTreeDiffView(input), [input]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(Object.values(view.rows).filter((row) => row.childRowIds.length > 0).map((row) => row.rowId)),
  );
  const [selectedRowId, setSelectedRowId] = useState<string | undefined>();
  const visibleRows = projectRows(view, expanded);
  useEffect(() => {
    setExpanded((current) => {
      const retained = [...current].filter((rowId) => view.rows[rowId]?.childRowIds.length > 0);
      return retained.length === current.size ? current : new Set(retained);
    });
    setSelectedRowId((current) => current !== undefined && view.rows[current] === undefined ? undefined : current);
  }, [view]);

  function handleKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    row: OutlineTreeDiffRowView,
    rowIndex: number,
  ): void {
    let targetRowId: string | undefined;
    if (event.key === "ArrowDown") targetRowId = visibleRows[rowIndex + 1]?.row.rowId;
    else if (event.key === "ArrowUp") targetRowId = visibleRows[rowIndex - 1]?.row.rowId;
    else if (event.key === "ArrowRight" && row.childRowIds.length > 0) {
      setExpanded((current) => new Set(current).add(row.rowId));
    } else if (event.key === "ArrowLeft") {
      if (expanded.has(row.rowId)) setExpanded((current) => toggleSet(current, row.rowId));
      else targetRowId = row.parentRowId;
    } else if (event.key === "Enter" || event.key === " ") {
      targetRowId = row.rowId;
    } else return;
    event.preventDefault();
    if (targetRowId === undefined) return;
    setSelectedRowId(targetRowId);
    const tree = event.currentTarget.parentElement;
    queueMicrotask(() => {
      const target = [...(tree?.querySelectorAll<HTMLElement>("[data-outline-diff-row-id]") ?? [])]
        .find((candidate) => candidate.dataset.outlineDiffRowId === targetRowId);
      target?.focus();
    });
  }
  return (
    <section className="novel-outline-diff-reviewer">
      <div className="novel-outline-diff-legend" aria-label="大纲差异图例">
        {(["added", "deleted", "modified-after", "moved", "unchanged"] as const).map((kind) => (
          <span key={kind} data-diff-kind={kind}>{diffLabel(kind)}</span>
        ))}
      </div>
      <div className="novel-outline-diff-tree" role="tree" aria-label="大纲差异树">
        {visibleRows.map(({ row, depth }, rowIndex) => {
          const expandable = row.childRowIds.length > 0;
          const isExpanded = expandable && expanded.has(row.rowId);
          return (
            <div
              className="novel-outline-diff-row"
              data-diff-kind={row.diffKind}
              data-selected={selectedRowId === row.rowId}
              data-outline-diff-row-id={row.rowId}
              key={row.rowId}
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={selectedRowId === row.rowId}
              {...(expandable ? { "aria-expanded": isExpanded } : {})}
              style={{ "--novel-outline-diff-indent": `${depth * 18}px` } as CSSProperties}
              tabIndex={selectedRowId === row.rowId || (selectedRowId === undefined && rowIndex === 0) ? 0 : -1}
              onClick={() => setSelectedRowId(row.rowId)}
              onKeyDown={(event) => handleKeyDown(event, row, rowIndex)}
            >
              <button
                type="button"
                className="novel-outline-diff-toggle"
                disabled={!expandable}
                aria-label={isExpanded ? "折叠差异行" : "展开差异行"}
                onClick={(event) => {
                  event.stopPropagation();
                  setExpanded((current) => toggleSet(current, row.rowId));
                }}
              >
                {expandable ? (isExpanded ? "▾" : "▸") : "·"}
              </button>
              <div className="novel-outline-diff-main">
                <header>
                  <strong>{row.title}</strong>
                  <span>{diffLabel(row.diffKind)}</span>
                </header>
                <div className="novel-outline-diff-status">
                  {row.scope !== undefined ? <span>{row.scope.label}</span> : null}
                  <span>{planningLabel(row.planningStatus)}</span>
                  <span>{realizationLabel(row.realizationStatus)}</span>
                  {row.blockState !== undefined ? <span title={row.blockState.label}>阻塞</span> : null}
                  {row.progress.totalLeafCount > 1 || row.childRowIds.length > 0 ? (
                    <span>{row.progress.completedLeafCount}/{row.progress.totalLeafCount}</span>
                  ) : null}
                </div>
                {row.diffKind === "moved" ? (
                  <p className="novel-outline-move-path">
                    {row.sourcePath?.join(" › ")} → {row.targetPath?.join(" › ")}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function projectRows(view: OutlineTreeDiffView, expanded: ReadonlySet<string>) {
  const result: { readonly row: OutlineTreeDiffRowView; readonly depth: number }[] = [];
  const stack = view.rootRowIds.slice().reverse().map((rowId) => ({ rowId, depth: 0 }));
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const row = view.rows[frame.rowId];
    result.push({ row, depth: frame.depth });
    if (!expanded.has(row.rowId)) continue;
    for (let index = row.childRowIds.length - 1; index >= 0; index -= 1) {
      stack.push({ rowId: row.childRowIds[index], depth: frame.depth + 1 });
    }
  }
  return result;
}

function toggleSet(current: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function diffLabel(kind: OutlineTreeDiffKind): string {
  switch (kind) {
    case "unchanged": return "上下文";
    case "added": return "新增";
    case "deleted": return "删除";
    case "modified-before": return "修改前";
    case "modified-after": return "修改后";
    case "moved": return "移动";
  }
}

function planningLabel(value: OutlineTreeDiffRowView["planningStatus"]): string {
  return value === "idea" ? "构想" : value === "outlined" ? "已大纲" : "可写";
}

function realizationLabel(value: OutlineTreeDiffRowView["realizationStatus"]): string {
  if (value === "pending") return "未开始";
  if (value === "in-progress") return "进行中";
  if (value === "completed") return "已完成";
  return "已放弃";
}
