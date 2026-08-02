/** Ordered Manuscript Block Diff view without choosing Anchor or inline-word protocols. */
export type ManuscriptBlockDiffKind =
  | "unchanged"
  | "added"
  | "deleted"
  | "modified-before"
  | "modified-after"
  | "moved";

export interface ManuscriptBlockDiffRowView {
  readonly rowId: string;
  readonly blockId: string;
  readonly diffKind: ManuscriptBlockDiffKind;
  readonly changeId?: string;
  readonly text: string;
  readonly contextLabel?: string;
  readonly sourceLabel?: string;
  readonly targetLabel?: string;
}

export interface ManuscriptBlockDiffView {
  readonly rows: readonly ManuscriptBlockDiffRowView[];
}

const DIFF_KINDS = new Set<ManuscriptBlockDiffKind>([
  "unchanged",
  "added",
  "deleted",
  "modified-before",
  "modified-after",
  "moved",
]);

export function captureManuscriptBlockDiffView(
  view: ManuscriptBlockDiffView,
): ManuscriptBlockDiffView {
  const rows = view.rows.map(captureRow);
  if (new Set(rows.map((row) => row.rowId)).size !== rows.length) {
    throw new TypeError("Manuscript Diff row ids must be unique");
  }
  validateBlockIdentity(rows);
  return Object.freeze({ rows: Object.freeze(rows) });
}

function captureRow(row: ManuscriptBlockDiffRowView): ManuscriptBlockDiffRowView {
  if (!DIFF_KINDS.has(row.diffKind)) throw new TypeError("Manuscript Diff kind is invalid");
  const changed = row.diffKind !== "unchanged";
  if (changed !== (row.changeId !== undefined)) {
    throw new TypeError("Manuscript Diff change identity is inconsistent");
  }
  const sourceLabel = row.sourceLabel;
  const targetLabel = row.targetLabel;
  const moved =
    row.diffKind === "moved" &&
    sourceLabel !== undefined &&
    targetLabel !== undefined;
  if (
    moved !== (row.diffKind === "moved") ||
    (row.diffKind !== "moved" && (sourceLabel !== undefined || targetLabel !== undefined))
  ) {
    throw new TypeError("Manuscript Diff move labels are inconsistent");
  }
  return Object.freeze({
    rowId: captureToken(row.rowId, "Manuscript Diff row id"),
    blockId: captureToken(row.blockId, "Manuscript Block id"),
    diffKind: row.diffKind,
    ...(row.changeId !== undefined
      ? { changeId: captureToken(row.changeId, "Manuscript Diff change id") }
      : {}),
    text: captureText(row.text, "Manuscript Block text", 100_000),
    ...(row.contextLabel !== undefined
      ? { contextLabel: captureText(row.contextLabel, "Manuscript context label", 500) }
      : {}),
    ...(moved
      ? {
          sourceLabel: captureText(sourceLabel, "Manuscript move source label", 500),
          targetLabel: captureText(targetLabel, "Manuscript move target label", 500),
        }
      : {}),
  });
}

function validateBlockIdentity(rows: readonly ManuscriptBlockDiffRowView[]): void {
  const byBlock = new Map<string, ManuscriptBlockDiffRowView[]>();
  const byChange = new Map<string, ManuscriptBlockDiffRowView[]>();
  for (const row of rows) {
    byBlock.set(row.blockId, [...(byBlock.get(row.blockId) ?? []), row]);
    if (row.changeId !== undefined) {
      byChange.set(row.changeId, [...(byChange.get(row.changeId) ?? []), row]);
    }
  }
  for (const blockRows of byBlock.values()) {
    if (blockRows.length === 1) continue;
    const kinds = new Set(blockRows.map((row) => row.diffKind));
    const changeIds = new Set(blockRows.map((row) => row.changeId));
    if (
      blockRows.length !== 2 ||
      !kinds.has("modified-before") ||
      !kinds.has("modified-after") ||
      changeIds.size !== 1
    ) {
      throw new TypeError("Manuscript Diff duplicates Block identity incorrectly");
    }
  }
  for (const changeRows of byChange.values()) {
    const modified = changeRows.some((row) => row.diffKind.startsWith("modified-"));
    if (
      modified &&
      (changeRows.length !== 2 ||
        !changeRows.some((row) => row.diffKind === "modified-before") ||
        !changeRows.some((row) => row.diffKind === "modified-after") ||
        new Set(changeRows.map((row) => row.blockId)).size !== 1)
    ) {
      throw new TypeError("Manuscript modified Blocks must form a pair");
    }
  }
}

function captureToken(value: string, label: string): string {
  return captureText(value, label, 200);
}

function captureText(value: string, label: string, maximumLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength || /\u0000/u.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
