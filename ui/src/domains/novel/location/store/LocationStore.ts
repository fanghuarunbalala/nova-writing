/**
 * LocationStore
 *
 * 地点域 store：列表 + 详情缓存 + 本地选中 + 写路径（create/update/delete，乐观锁）。
 * 说明：core Location 无 locState 字段，snapshot 暂统一 "filed"；
 * 草稿新增态等 core 契约落地后补充。role 取首个 alias，profile 取 authorNotes。
 * stale：NovelStaleRevisionError 经门面归一为 RPCError code:"stale"——自动重拉
 * 并置 error 提示（数据已被更新）。
 */
import type { Location, LocationId, LocationInput, Logger, NovelApiClient } from "@novel/core";
import { noopLogger } from "@novel/core/client";
import { TaskSerializer } from "../../../../shared/state/TaskSerializer.js";
import { WorkspaceDomainStore, type ReadyWorkspaceDomainSnapshot } from "../../../../shared/state/WorkspaceDomainStore.js";
import type { NovelDomainError } from "../../outline/store/StoryOutlineTreeStore.js";

export type LocationState = "filed" | "draft-new";

export interface LocationSummary {
  readonly locationId: string;
  readonly avatarText: string;
  readonly name: string;
  readonly role: string;
  readonly locState: LocationState;
  readonly note: string;
  readonly relatedUnits: readonly string[];
}

export interface LocationDetail {
  readonly locationId: string;
  readonly avatarText: string;
  readonly name: string;
  readonly role: string;
  readonly locState: LocationState;
  readonly summary: string;
  readonly initialState: string;
  readonly profile: string;
  /** 实体版本（乐观锁 baseRevision） */
  readonly version: number;
  readonly relatedUnits: readonly { readonly unitId: string; readonly label: string }[];
}

export interface LocationSnapshot {
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly workspaceId: string | undefined;
  readonly locations: readonly LocationSummary[];
  readonly detailCache: ReadonlyMap<string, LocationDetail>;
  readonly selectedId: string | undefined;
  readonly error: NovelDomainError | undefined;
}

const EMPTY_SNAPSHOT: LocationSnapshot = Object.freeze({
  phase: "idle",
  workspaceId: undefined,
  locations: Object.freeze([]),
  detailCache: new Map<string, LocationDetail>(),
  selectedId: undefined,
  error: undefined,
});

export class LocationStore extends WorkspaceDomainStore<LocationSnapshot> {
  private readonly api: NovelApiClient;
  private readonly logger: Logger;
  /** 变更串行（乐观锁操作不并发） */
  private readonly serializer = new TaskSerializer();

  constructor(deps: { readonly api: NovelApiClient; readonly logger?: Logger }) {
    super(
      EMPTY_SNAPSHOT,
      Object.freeze({
        code: "novel-load-failed",
        message: "地点列表加载失败，请重试",
        retryable: true,
      }),
    );
    this.api = deps.api;
    this.logger = (deps.logger ?? noopLogger).child({
      component: "location_store",
    });
  }

  protected async fetchReadySnapshot(
    workspaceId: string,
    generation: number,
  ): Promise<ReadyWorkspaceDomainSnapshot<LocationSnapshot> | undefined> {
    const result = await this.api.novel.locations.list();
    if (this.isStaleGeneration(generation)) return undefined;
    return {
      phase: "ready",
      workspaceId,
      locations: Object.freeze(result.map(captureSummary)),
      detailCache: new Map<string, LocationDetail>(),
      selectedId: undefined,
      error: undefined,
    };
  }

  protected override onLoadSucceeded(snapshot: LocationSnapshot): void {
    this.logger.info("location_store.load_completed", {
      locationCount: snapshot.locations.length,
    });
  }

  protected override onLoadFailed(): void {
    this.logger.warn("location_store.load_failed");
  }

  async loadDetail(locationId: string): Promise<void> {
    const capturedId = requireNonBlank(locationId, "Location id");
    if (this.snapshot.detailCache.has(capturedId)) return;
    const generation = this.currentGeneration;
    try {
      const location = await this.api.novel.locations.get(capturedId as LocationId);
      if (this.isStaleGeneration(generation)) return;
      const detail = captureDetail(location);
      const detailCache = new Map(this.snapshot.detailCache);
      detailCache.set(capturedId, detail);
      this.setSnapshot({ ...this.snapshot, detailCache });
      this.logger.info("location_store.detail_loaded");
    } catch {
      this.logger.warn("location_store.detail_load_failed");
    }
  }

  selectLocation(id: string | undefined): void {
    this.setSnapshot({ ...this.snapshot, selectedId: id });
  }

  /**
   * 新建地点（成功后刷新列表并选中新地点）
   * @param input 地点档案输入
   */
  createLocation(input: LocationInput): Promise<void> {
    const workspaceId = this.snapshot.workspaceId;
    if (workspaceId === undefined) return Promise.resolve();
    return this.serializer.run(async () => {
      const result = await this.api.novel.mutate({ op: "location.create", input });
      await this.loadWorkspace(workspaceId);
      this.setSnapshot({ ...this.snapshot, selectedId: result.changeId });
    });
  }

  /**
   * 更新地点（乐观锁；stale 时自动重拉并置提示）
   * @param locationId 地点 id
   * @param patch 变更字段
   * @param baseRevision 最近读到的版本（entityVersion）
   */
  updateLocation(locationId: string, patch: Partial<LocationInput>, baseRevision: number): Promise<void> {
    return this.serializer.run(async () => {
      await this.runGuarded(
        () =>
          this.api.novel.mutate({
            op: "location.update",
            locationId: locationId as LocationId,
            baseRevision,
            patch,
          }),
        "地点",
      );
    });
  }

  /**
   * 删除地点（乐观锁；成功后清选中并刷新）
   * @param locationId 地点 id
   * @param baseRevision 最近读到的版本（entityVersion）
   */
  deleteLocation(locationId: string, baseRevision: number): Promise<void> {
    return this.serializer.run(async () => {
      await this.runGuarded(
        () =>
          this.api.novel.mutate({
            op: "location.delete",
            locationId: locationId as LocationId,
            baseRevision,
          }),
        "地点",
      );
      const workspaceId = this.snapshot.workspaceId;
      this.setSnapshot({ ...this.snapshot, selectedId: undefined });
      if (workspaceId !== undefined) await this.loadWorkspace(workspaceId);
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
      this.logger.warn("location_store.mutate_failed");
    }
  }
}

function captureSummary(location: Location): LocationSummary {
  return Object.freeze({
    locationId: location.id,
    avatarText: location.name.slice(0, 1),
    name: location.name,
    role: location.aliases[0] ?? "地点",
    locState: "filed" as const,
    note: location.summary ?? "",
    relatedUnits: Object.freeze([]),
  });
}

function captureDetail(location: Location): LocationDetail {
  return Object.freeze({
    locationId: location.id,
    avatarText: location.name.slice(0, 1),
    name: location.name,
    role: location.aliases[0] ?? "地点",
    locState: "filed" as const,
    summary: location.summary ?? "",
    initialState: location.initialState ?? "",
    profile: location.authorNotes ?? "",
    version: location.entityVersion,
    relatedUnits: Object.freeze([]),
  });
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}
