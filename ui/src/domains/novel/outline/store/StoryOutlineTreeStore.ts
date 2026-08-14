/**
 * StoryOutlineTreeStore
 *
 * 大纲树域 store：加载 core outline、构建树、维护展开/选中本地视图状态 +
 * 写路径（story unit create/update/delete/move，乐观锁）。
 * unitsById 持有 core StoryUnit（版本号 = 乐观锁 baseRevision；树节点只有投影字段）。
 * stale：NovelStaleRevisionError 经门面归一为 RPCError code:"stale"——自动重拉
 * 并置 error 提示（数据已被更新）。
 */
import type {
  Logger,
  NovelApiClient,
  OrderKey,
  StoryUnit,
  StoryUnitId,
  StoryUnitScope,
} from "@novel/core";
import { noopLogger } from "@novel/core/client";
import { WorkspaceDomainStore, type ReadyWorkspaceDomainSnapshot } from "../../../../shared/state/WorkspaceDomainStore.js";
import { TaskSerializer } from "../../../../shared/state/TaskSerializer.js";
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

export class StoryOutlineTreeStore extends WorkspaceDomainStore<StoryOutlineTreeSnapshot> {
  private readonly api: NovelApiClient;
  private readonly logger: Logger;
  /** 变更串行（乐观锁操作不并发） */
  private readonly serializer = new TaskSerializer();
  /** 单元版本缓存（id → core StoryUnit，乐观锁 baseRevision 来源） */
  private unitsById: ReadonlyMap<string, StoryUnit> = new Map();

  constructor(deps: { readonly api: NovelApiClient; readonly logger?: Logger }) {
    super(
      EMPTY_SNAPSHOT,
      Object.freeze({
        code: "novel-load-failed",
        message: "大纲加载失败，请重试",
        retryable: true,
      }),
    );
    this.api = deps.api;
    this.logger = (deps.logger ?? noopLogger).child({
      component: "story_outline_tree_store",
    });
  }

  protected async fetchReadySnapshot(
    workspaceId: string,
    generation: number,
  ): Promise<ReadyWorkspaceDomainSnapshot<StoryOutlineTreeSnapshot> | undefined> {
    const outline = await this.api.novel.outline.get();
    if (this.isStaleGeneration(generation)) return undefined;
    const tree = StoryOutlineTreeProjection.build(outline.units);
    this.unitsById = new Map(outline.units.map((unit) => [unit.id, unit]));
    return {
      phase: "ready",
      workspaceId,
      tree,
      expansionState: new Map<string, boolean>(),
      selectedUnitId: undefined,
      error: undefined,
    };
  }

  protected override onLoadSucceeded(snapshot: StoryOutlineTreeSnapshot): void {
    this.logger.info("story_outline_tree.load_completed", {
      unitCount: snapshot.tree.length,
    });
  }

  protected override onLoadFailed(): void {
    this.logger.warn("story_outline_tree.load_failed");
  }

  /** 单元版本（乐观锁 baseRevision）；未加载/不存在返回 undefined */
  getUnit(unitId: string): StoryUnit | undefined {
    return this.unitsById.get(unitId);
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

  /**
   * 新建 story unit（可选挂 parentId；orderKey 未给时时间戳兜底）
   * @param input 单元输入
   */
  createStoryUnit(input: {
    parentId?: StoryUnitId;
    title: string;
    intent?: string;
    synopsis?: string;
    scope?: StoryUnitScope;
  }): Promise<void> {
    return this.serializer.run(async () => {
      await this.runGuarded(
        () =>
          this.api.novel.mutate({
            op: "outline.storyUnit.create",
            parentId: input.parentId,
            orderKey: String(Date.now()) as OrderKey,
            title: input.title,
            intent: input.intent,
            synopsis: input.synopsis,
            scope: input.scope,
          }),
        "大纲",
      );
    });
  }

  /**
   * 更新 story unit（乐观锁；stale 自动重拉 + 提示）
   * @param unitId 单元 id
   * @param patch 变更字段（title/intent/synopsis/scope）
   * @param baseRevision 最近读到的版本（entityVersion）
   */
  updateStoryUnit(
    unitId: string,
    patch: { title?: string; intent?: string; synopsis?: string; scope?: StoryUnitScope },
    baseRevision: number,
  ): Promise<void> {
    return this.serializer.run(async () => {
      await this.runGuarded(
        () =>
          this.api.novel.mutate({
            op: "outline.storyUnit.update",
            storyUnitId: unitId as StoryUnitId,
            baseRevision,
            patch,
          }),
        "大纲",
      );
    });
  }

  /**
   * 删除 story unit（乐观锁；成功后清选中并刷新）
   * @param unitId 单元 id
   * @param baseRevision 最近读到的版本（entityVersion）
   */
  deleteStoryUnit(unitId: string, baseRevision: number): Promise<void> {
    return this.serializer.run(async () => {
      await this.runGuarded(
        () =>
          this.api.novel.mutate({
            op: "outline.storyUnit.delete",
            storyUnitId: unitId as StoryUnitId,
            baseRevision,
          }),
        "大纲",
      );
      const workspaceId = this.snapshot.workspaceId;
      this.setSnapshot({ ...this.snapshot, selectedUnitId: undefined });
      if (workspaceId !== undefined) await this.loadWorkspace(workspaceId);
    });
  }

  /**
   * 移动 story unit（乐观锁；挂新父节点/调整 orderKey）
   * @param unitId 单元 id
   * @param target 新父节点（undefined = 顶层）与 orderKey
   * @param baseRevision 最近读到的版本（entityVersion）
   */
  moveStoryUnit(
    unitId: string,
    target: { parentId?: StoryUnitId; orderKey: OrderKey },
    baseRevision: number,
  ): Promise<void> {
    return this.serializer.run(async () => {
      await this.runGuarded(
        () =>
          this.api.novel.mutate({
            op: "outline.storyUnit.move",
            storyUnitId: unitId as StoryUnitId,
            baseRevision,
            parentId: target.parentId,
            orderKey: target.orderKey,
          }),
        "大纲",
      );
    });
  }

  /** 变更执行 + stale/通用错误处理（stale → 自动重拉 + 置错误提示） */
  private async runGuarded(mutate: () => Promise<unknown>, label: string): Promise<void> {
    try {
      await mutate();
      this.setSnapshot({ ...this.snapshot, error: undefined });
      const workspaceId = this.snapshot.workspaceId;
      if (workspaceId !== undefined) await this.loadWorkspace(workspaceId);
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code === "stale") {
        this.setSnapshot({
          ...this.snapshot,
          error: {
            code: "novel-stale",
            message: `${label}数据已被更新，已刷新为最新版本，请重试`,
            retryable: true,
          },
        });
        const workspaceId = this.snapshot.workspaceId;
        if (workspaceId !== undefined) await this.loadWorkspace(workspaceId);
        return;
      }
      this.setSnapshot({
        ...this.snapshot,
        error: {
          code: "novel-mutate-failed",
          message: `${label}保存失败，请重试`,
          retryable: true,
        },
      });
      this.logger.warn("story_outline_tree.mutate_failed");
    }
  }
}

function collectUnitIds(node: StoryOutlineTreeNode, into: Map<string, boolean>): void {
  into.set(node.unitId, false);
  for (const child of node.children) {
    collectUnitIds(child, into);
  }
}
