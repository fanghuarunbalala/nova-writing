/**
 * StoryOutlineTreeStore
 *
 * 大纲树域 store：加载 core outline、构建树、维护展开/选中本地视图状态。
 */
import {
  canonicalNovelQueryScope,
  noopLogger,
  type Logger,
  type NovelApiClient,
} from "@novel/core";
import { ExternalStore } from "../../../../shared/state/ExternalStore.js";
import {
  StoryOutlineTreeProjection,
  type StoryOutlineTreeNode,
} from "../projection/StoryOutlineTreeProjection.js";

export interface NovelDomainError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface StoryOutlineTreeSnapshot {
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly workspaceId: string | undefined;
  readonly tree: readonly StoryOutlineTreeNode[];
  readonly expansionState: ReadonlyMap<string, boolean>;
  readonly selectedUnitId: string | undefined;
  readonly error: NovelDomainError | undefined;
}

const EMPTY_SNAPSHOT: StoryOutlineTreeSnapshot = Object.freeze({
  phase: "idle",
  workspaceId: undefined,
  tree: Object.freeze([]),
  expansionState: new Map<string, boolean>(),
  selectedUnitId: undefined,
  error: undefined,
});

export class StoryOutlineTreeStore extends ExternalStore<StoryOutlineTreeSnapshot> {
  private readonly api: NovelApiClient;
  private readonly logger: Logger;
  private generation = 0;

  constructor(deps: { readonly api: NovelApiClient; readonly logger?: Logger }) {
    super(EMPTY_SNAPSHOT);
    this.api = deps.api;
    this.logger = (deps.logger ?? noopLogger).child({
      component: "story_outline_tree_store",
    });
  }

  async loadWorkspace(workspaceId: string): Promise<void> {
    const capturedId = requireNonBlank(workspaceId, "Workspace id");
    const generation = ++this.generation;
    this.setSnapshot({
      ...EMPTY_SNAPSHOT,
      phase: "loading",
      workspaceId: capturedId,
    });
    try {
      const outline = await this.api.novel.outline.get(canonicalNovelQueryScope);
      if (generation !== this.generation) return;
      const tree = StoryOutlineTreeProjection.build(
        outline.tree?.units ?? [],
        outline.progress,
      );
      this.setSnapshot({
        phase: "ready",
        workspaceId: capturedId,
        tree,
        expansionState: new Map<string, boolean>(),
        selectedUnitId: undefined,
        error: undefined,
      });
      this.logger.info("story_outline_tree.load_completed", { unitCount: tree.length });
    } catch {
      if (generation !== this.generation) return;
      this.setSnapshot({
        ...EMPTY_SNAPSHOT,
        phase: "error",
        workspaceId: capturedId,
        error: {
          code: "novel-load-failed",
          message: "大纲加载失败，请重试",
          retryable: true,
        },
      });
      this.logger.warn("story_outline_tree.load_failed");
    }
  }

  selectUnit(unitId: string | undefined): void {
    this.setSnapshot({ ...this.snapshot, selectedUnitId: unitId });
  }

  toggleExpand(unitId: string): void {
    const next = new Map(this.snapshot.expansionState);
    next.set(unitId, !(next.get(unitId) ?? false));
    this.setSnapshot({ ...this.snapshot, expansionState: next });
  }

  expandAll(): void {
    const next = new Map<string, boolean>();
    for (const node of this.snapshot.tree) {
      collectUnitIds(node, next);
    }
    for (const key of next.keys()) next.set(key, true);
    this.setSnapshot({ ...this.snapshot, expansionState: next });
  }

  collapseAll(): void {
    const next = new Map<string, boolean>();
    for (const node of this.snapshot.tree) {
      collectUnitIds(node, next);
    }
    for (const key of next.keys()) next.set(key, false);
    this.setSnapshot({ ...this.snapshot, expansionState: next });
  }

  invalidate(): Promise<void> {
    const workspaceId = this.snapshot.workspaceId;
    if (workspaceId === undefined) return Promise.resolve();
    return this.loadWorkspace(workspaceId);
  }
}

function collectUnitIds(node: StoryOutlineTreeNode, into: Map<string, boolean>): void {
  into.set(node.unitId, false);
  for (const child of node.children) {
    collectUnitIds(child, into);
  }
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}
