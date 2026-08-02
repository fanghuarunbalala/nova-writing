/** Local expansion, selection, and visible-row projection over a normalized Outline. */
import {
  captureStoryOutlineTreeView,
  type StoryOutlineTreeView,
  type StoryUnitTreeNodeView,
} from "./StoryOutlineTreeView.js";

export interface VisibleStoryUnitRow {
  readonly id: string;
  readonly node: StoryUnitTreeNodeView;
  readonly depth: number;
  readonly expanded: boolean;
  readonly expandable: boolean;
  readonly selected: boolean;
  readonly positionInSet: number;
  readonly setSize: number;
}

export interface StoryOutlineTreeSnapshot {
  readonly revision: number;
  readonly view: StoryOutlineTreeView;
  readonly expandedIds: readonly string[];
  readonly selectedId?: string;
  readonly visibleRows: readonly VisibleStoryUnitRow[];
}

export interface StoryOutlineTreeControllerOptions {
  readonly view: StoryOutlineTreeView;
  readonly expandedIds?: readonly string[];
  readonly selectedId?: string;
}

export type StoryOutlineTreeListener = () => void;

export class StoryOutlineTreeController {
  private readonly listeners = new Set<StoryOutlineTreeListener>();
  private view: StoryOutlineTreeView;
  private expandedIds: Set<string>;
  private selectedId?: string;
  private revision = 0;
  private snapshot: StoryOutlineTreeSnapshot;

  constructor(options: StoryOutlineTreeControllerOptions) {
    this.view = captureStoryOutlineTreeView(options.view);
    this.expandedIds = captureExpandedIds(options.expandedIds ?? [], this.view);
    this.selectedId = captureSelection(options.selectedId, this.view);
    this.snapshot = this.buildSnapshot();
  }

  getSnapshot(): StoryOutlineTreeSnapshot {
    return this.snapshot;
  }

  subscribe(listener: StoryOutlineTreeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  replaceView(view: StoryOutlineTreeView): void {
    this.view = captureStoryOutlineTreeView(view);
    this.expandedIds = new Set(
      [...this.expandedIds].filter((id) => this.view.nodes[id]?.childIds.length > 0),
    );
    this.selectedId = retainSelection(this.selectedId, this.view);
    this.publish();
  }

  select(id: string | undefined): void {
    const selectedId = captureSelection(id, this.view);
    if (selectedId === this.selectedId) return;
    this.selectedId = selectedId;
    this.publish();
  }

  toggle(id: string): void {
    const node = requireNode(this.view, id);
    if (node.childIds.length === 0) return;
    if (this.expandedIds.has(id)) this.expandedIds.delete(id);
    else this.expandedIds.add(id);
    this.publish();
  }

  expand(id: string): void {
    const node = requireNode(this.view, id);
    if (node.childIds.length === 0 || this.expandedIds.has(id)) return;
    this.expandedIds.add(id);
    this.publish();
  }

  collapse(id: string): void {
    requireNode(this.view, id);
    if (!this.expandedIds.delete(id)) return;
    this.publish();
  }

  selectNext(): void {
    this.moveVisibleSelection(1);
  }

  selectPrevious(): void {
    this.moveVisibleSelection(-1);
  }

  selectParent(): void {
    if (this.selectedId === undefined) return;
    const parentId = requireNode(this.view, this.selectedId).parentId;
    if (parentId !== undefined) this.select(parentId);
  }

  selectFirstChild(): void {
    if (this.selectedId === undefined) return;
    const node = requireNode(this.view, this.selectedId);
    const childId = node.childIds[0];
    if (childId === undefined) return;
    this.expandedIds.add(node.id);
    this.selectedId = childId;
    this.publish();
  }

  toggleSelected(): void {
    if (this.selectedId !== undefined) this.toggle(this.selectedId);
  }

  private moveVisibleSelection(offset: -1 | 1): void {
    const rows = this.snapshot.visibleRows;
    if (rows.length === 0) return;
    const currentIndex = rows.findIndex((row) => row.id === this.selectedId);
    const nextIndex = currentIndex < 0
      ? offset === 1 ? 0 : rows.length - 1
      : Math.min(rows.length - 1, Math.max(0, currentIndex + offset));
    this.select(rows[nextIndex]?.id);
  }

  private publish(): void {
    this.revision += 1;
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener();
  }

  private buildSnapshot(): StoryOutlineTreeSnapshot {
    return Object.freeze({
      revision: this.revision,
      view: this.view,
      expandedIds: Object.freeze([...this.expandedIds]),
      ...(this.selectedId !== undefined ? { selectedId: this.selectedId } : {}),
      visibleRows: projectVisibleRows(this.view, this.expandedIds, this.selectedId),
    });
  }
}

export function projectVisibleRows(
  view: StoryOutlineTreeView,
  expandedIds: ReadonlySet<string>,
  selectedId?: string,
): readonly VisibleStoryUnitRow[] {
  const rows: VisibleStoryUnitRow[] = [];
  const stack = view.rootIds
    .slice()
    .reverse()
    .map((id, reverseIndex) => ({
      id,
      depth: 0,
      positionInSet: view.rootIds.length - reverseIndex,
      setSize: view.rootIds.length,
    }));
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const node = requireNode(view, frame.id);
    const expanded = expandedIds.has(node.id) && node.childIds.length > 0;
    rows.push(
      Object.freeze({
        id: node.id,
        node,
        depth: frame.depth,
        expanded,
        expandable: node.childIds.length > 0,
        selected: node.id === selectedId,
        positionInSet: frame.positionInSet,
        setSize: frame.setSize,
      }),
    );
    if (!expanded) continue;
    for (let index = node.childIds.length - 1; index >= 0; index -= 1) {
      stack.push({
        id: node.childIds[index],
        depth: frame.depth + 1,
        positionInSet: index + 1,
        setSize: node.childIds.length,
      });
    }
  }
  return Object.freeze(rows);
}

function captureExpandedIds(
  values: readonly string[],
  view: StoryOutlineTreeView,
): Set<string> {
  const expanded = new Set<string>();
  for (const id of values) {
    const node = requireNode(view, id);
    if (node.childIds.length > 0) expanded.add(id);
  }
  return expanded;
}

function captureSelection(
  id: string | undefined,
  view: StoryOutlineTreeView,
): string | undefined {
  if (id === undefined) return undefined;
  requireNode(view, id);
  return id;
}

function retainSelection(
  id: string | undefined,
  view: StoryOutlineTreeView,
): string | undefined {
  return id !== undefined && view.nodes[id] !== undefined ? id : undefined;
}

function requireNode(view: StoryOutlineTreeView, id: string): StoryUnitTreeNodeView {
  const node = view.nodes[id];
  if (node === undefined) throw new TypeError("StoryUnit does not exist in Outline view");
  return node;
}
