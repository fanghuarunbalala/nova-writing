/** Normalized tree Diff preserving StoryUnit identity, tombstones, pairs, and moves. */
import type {
  StoryUnitBlockStateView,
  StoryUnitPlanningStatus,
  StoryUnitProgressProjection,
  StoryUnitRealizationStatus,
  StoryUnitScopeView,
} from "../../outline/index.js";

export type OutlineTreeDiffKind =
  | "unchanged"
  | "added"
  | "deleted"
  | "modified-before"
  | "modified-after"
  | "moved";

export interface OutlineTreeDiffRowView {
  readonly rowId: string;
  readonly storyUnitId: string;
  readonly parentRowId?: string;
  readonly childRowIds: readonly string[];
  readonly diffKind: OutlineTreeDiffKind;
  readonly changeId?: string;
  readonly title: string;
  readonly scope?: StoryUnitScopeView;
  readonly planningStatus: StoryUnitPlanningStatus;
  readonly realizationStatus: StoryUnitRealizationStatus;
  readonly blockState?: StoryUnitBlockStateView;
  readonly progress: StoryUnitProgressProjection;
  readonly sourcePath?: readonly string[];
  readonly targetPath?: readonly string[];
}

export interface OutlineTreeDiffView {
  readonly rootRowIds: readonly string[];
  readonly rows: Readonly<Record<string, OutlineTreeDiffRowView>>;
}

const DIFF_KINDS = new Set<OutlineTreeDiffKind>([
  "unchanged",
  "added",
  "deleted",
  "modified-before",
  "modified-after",
  "moved",
]);
const PLANNING = new Set<StoryUnitPlanningStatus>(["idea", "outlined", "ready"]);
const REALIZATION = new Set<StoryUnitRealizationStatus>([
  "pending",
  "in-progress",
  "completed",
  "abandoned",
]);

export function captureOutlineTreeDiffView(view: OutlineTreeDiffView): OutlineTreeDiffView {
  const rootRowIds = captureUniqueTokens(view.rootRowIds, "Outline Diff root row ids");
  const rows = new Map<string, OutlineTreeDiffRowView>();
  for (const [recordId, row] of Object.entries(view.rows)) {
    const captured = captureRow(row);
    if (recordId !== captured.rowId || rows.has(captured.rowId)) {
      throw new TypeError("Outline Diff row identity is inconsistent");
    }
    rows.set(captured.rowId, captured);
  }
  validateTree(rootRowIds, rows);
  validateChangePairs(rows);
  return Object.freeze({
    rootRowIds,
    rows: Object.freeze(Object.fromEntries(rows)),
  });
}

function captureRow(row: OutlineTreeDiffRowView): OutlineTreeDiffRowView {
  if (!DIFF_KINDS.has(row.diffKind)) throw new TypeError("Outline Diff kind is invalid");
  if (!PLANNING.has(row.planningStatus)) {
    throw new TypeError("Outline Diff planning status is invalid");
  }
  if (!REALIZATION.has(row.realizationStatus)) {
    throw new TypeError("Outline Diff realization status is invalid");
  }
  const requiresChange = row.diffKind !== "unchanged";
  if (requiresChange !== (row.changeId !== undefined)) {
    throw new TypeError("Outline Diff change identity is inconsistent");
  }
  const moved = row.diffKind === "moved";
  if (
    moved !== (row.sourcePath !== undefined && row.targetPath !== undefined) ||
    (!moved && (row.sourcePath !== undefined || row.targetPath !== undefined))
  ) {
    throw new TypeError("Outline Diff move paths are inconsistent");
  }
  const completedLeafCount = captureCount(row.progress.completedLeafCount);
  const totalLeafCount = captureCount(row.progress.totalLeafCount);
  if (completedLeafCount > totalLeafCount) {
    throw new TypeError("Outline Diff completed leaf count exceeds total");
  }
  return Object.freeze({
    rowId: captureToken(row.rowId, "Outline Diff row id"),
    storyUnitId: captureToken(row.storyUnitId, "Outline Diff StoryUnit id"),
    ...(row.parentRowId !== undefined
      ? { parentRowId: captureToken(row.parentRowId, "Outline Diff parent row id") }
      : {}),
    childRowIds: captureUniqueTokens(row.childRowIds, "Outline Diff child row ids"),
    diffKind: row.diffKind,
    ...(row.changeId !== undefined
      ? { changeId: captureToken(row.changeId, "Outline Diff change id") }
      : {}),
    title: captureText(row.title, "Outline Diff title", 500),
    ...(row.scope !== undefined
      ? {
          scope: Object.freeze({
            code: captureToken(row.scope.code, "Outline Diff scope code"),
            label: captureText(row.scope.label, "Outline Diff scope label", 500),
          }),
        }
      : {}),
    planningStatus: row.planningStatus,
    realizationStatus: row.realizationStatus,
    ...(row.blockState !== undefined
      ? {
          blockState: Object.freeze({
            code: captureToken(row.blockState.code, "Outline Diff block code"),
            label: captureText(row.blockState.label, "Outline Diff block label", 500),
          }),
        }
      : {}),
    progress: Object.freeze({ completedLeafCount, totalLeafCount }),
    ...(moved
      ? {
          sourcePath: capturePath(row.sourcePath, "Outline Diff source path"),
          targetPath: capturePath(row.targetPath, "Outline Diff target path"),
        }
      : {}),
  });
}

function validateTree(
  rootRowIds: readonly string[],
  rows: ReadonlyMap<string, OutlineTreeDiffRowView>,
): void {
  const roots = new Set(rootRowIds);
  const referenced = new Set<string>();
  for (const rootId of rootRowIds) {
    if (rows.get(rootId)?.parentRowId !== undefined || !rows.has(rootId)) {
      throw new TypeError("Outline Diff root row is invalid");
    }
  }
  for (const row of rows.values()) {
    if (row.parentRowId === undefined && !roots.has(row.rowId)) {
      throw new TypeError("Outline Diff contains an unlisted root");
    }
    for (const childId of row.childRowIds) {
      const child = rows.get(childId);
      if (child === undefined || child.parentRowId !== row.rowId || referenced.has(childId)) {
        throw new TypeError("Outline Diff child relationship is inconsistent");
      }
      referenced.add(childId);
    }
  }
  const visited = new Set<string>();
  const stack = [...rootRowIds].reverse();
  while (stack.length > 0) {
    const rowId = stack.pop();
    if (rowId === undefined) break;
    if (visited.has(rowId)) throw new TypeError("Outline Diff contains a cycle");
    visited.add(rowId);
    const row = rows.get(rowId);
    if (row === undefined) throw new TypeError("Outline Diff row does not exist");
    for (let index = row.childRowIds.length - 1; index >= 0; index -= 1) {
      stack.push(row.childRowIds[index]);
    }
  }
  if (visited.size !== rows.size) throw new TypeError("Outline Diff contains unreachable rows");
}

function validateChangePairs(rows: ReadonlyMap<string, OutlineTreeDiffRowView>): void {
  const rowsByStoryUnit = new Map<string, OutlineTreeDiffRowView[]>();
  const rowsByChange = new Map<string, OutlineTreeDiffRowView[]>();
  for (const row of rows.values()) {
    rowsByStoryUnit.set(row.storyUnitId, [
      ...(rowsByStoryUnit.get(row.storyUnitId) ?? []),
      row,
    ]);
    if (row.changeId !== undefined) {
      rowsByChange.set(row.changeId, [...(rowsByChange.get(row.changeId) ?? []), row]);
    }
  }
  for (const duplicates of rowsByStoryUnit.values()) {
    if (duplicates.length === 1) continue;
    const kinds = new Set(duplicates.map((row) => row.diffKind));
    const changeIds = new Set(duplicates.map((row) => row.changeId));
    if (
      duplicates.length !== 2 ||
      !kinds.has("modified-before") ||
      !kinds.has("modified-after") ||
      changeIds.size !== 1
    ) {
      throw new TypeError("Outline Diff duplicates StoryUnit identity incorrectly");
    }
  }
  for (const changeRows of rowsByChange.values()) {
    const hasModified = changeRows.some((row) => row.diffKind.startsWith("modified-"));
    if (
      hasModified &&
      (changeRows.length !== 2 ||
        !changeRows.some((row) => row.diffKind === "modified-before") ||
        !changeRows.some((row) => row.diffKind === "modified-after"))
    ) {
      throw new TypeError("Outline Diff modified rows must form a pair");
    }
  }
}

function capturePath(value: readonly string[] | undefined, label: string): readonly string[] {
  if (value === undefined || value.length === 0) throw new TypeError(`${label} is invalid`);
  return Object.freeze(value.map((part) => captureText(part, label, 500)));
}

function captureUniqueTokens(values: readonly string[], label: string): readonly string[] {
  const captured = values.map((value) => captureToken(value, label));
  if (new Set(captured).size !== captured.length) throw new TypeError(`${label} must be unique`);
  return Object.freeze(captured);
}

function captureCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Outline Diff count is invalid");
  return value;
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
