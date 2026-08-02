/** Block-oriented Manuscript Diff with stable identity and explicit move presentation. */
import { useMemo, useState } from "react";
import {
  captureManuscriptBlockDiffView,
  type ManuscriptBlockDiffKind,
  type ManuscriptBlockDiffView,
} from "./ManuscriptBlockDiffView.js";

export function ManuscriptChangeReviewer({
  view: input,
}: {
  readonly view: ManuscriptBlockDiffView;
}) {
  const view = useMemo(() => captureManuscriptBlockDiffView(input), [input]);
  const [selectedRowId, setSelectedRowId] = useState<string | undefined>();
  return (
    <section className="novel-manuscript-diff-reviewer">
      <div className="novel-manuscript-diff-legend" aria-label="正文差异图例">
        <span data-diff-kind="added">新增</span>
        <span data-diff-kind="deleted">删除</span>
        <span data-diff-kind="moved">移动</span>
        <span data-diff-kind="unchanged">上下文</span>
      </div>
      <div className="novel-manuscript-diff-blocks" role="list" aria-label="正文块差异">
        {view.rows.map((row) => (
          <article
            className="novel-manuscript-diff-block"
            data-diff-kind={row.diffKind}
            data-selected={selectedRowId === row.rowId}
            data-block-id={row.blockId}
            key={row.rowId}
            role="listitem"
            tabIndex={0}
            onClick={() => setSelectedRowId(row.rowId)}
            onFocus={() => setSelectedRowId(row.rowId)}
          >
            <header>
              <span>{row.contextLabel ?? "正文块"}</span>
              <strong>{diffLabel(row.diffKind)}</strong>
            </header>
            <p>{row.text}</p>
            {row.diffKind === "moved" ? (
              <footer>{row.sourceLabel} → {row.targetLabel}</footer>
            ) : null}
          </article>
        ))}
      </div>
      <p className="novel-manuscript-inline-diff-note">
        当前按稳定段落块审阅；行内词级差异尚未启用。
      </p>
    </section>
  );
}

function diffLabel(kind: ManuscriptBlockDiffKind): string {
  switch (kind) {
    case "unchanged": return "上下文";
    case "added": return "新增";
    case "deleted": return "删除";
    case "modified-before": return "修改前";
    case "modified-after": return "修改后";
    case "moved": return "移动";
  }
}
