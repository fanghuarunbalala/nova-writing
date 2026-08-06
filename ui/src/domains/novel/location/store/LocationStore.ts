/**
 * LocationStore
 *
 * 地点域 store：列表 + 详情缓存 + 本地选中。
 * 说明：core Location 无 locState 字段，snapshot 暂统一 "filed"；
 * 草稿新增态等 core 契约落地后补充。role 取首个 alias，profile 取 authorNotes。
 */
import {
  canonicalNovelQueryScope,
  noopLogger,
  type Location,
  type LocationId,
  type Logger,
  type NovelApiClient,
} from "@novel/core";
import { ExternalStore } from "../../../../shared/state/ExternalStore.js";
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
  readonly profile: string;
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

export class LocationStore extends ExternalStore<LocationSnapshot> {
  private readonly api: NovelApiClient;
  private readonly logger: Logger;
  private generation = 0;

  constructor(deps: { readonly api: NovelApiClient; readonly logger?: Logger }) {
    super(EMPTY_SNAPSHOT);
    this.api = deps.api;
    this.logger = (deps.logger ?? noopLogger).child({
      component: "location_store",
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
      const result = await this.api.novel.locations.list(canonicalNovelQueryScope);
      if (generation !== this.generation) return;
      this.setSnapshot({
        phase: "ready",
        workspaceId: capturedId,
        locations: Object.freeze(result.locations.map(captureSummary)),
        detailCache: new Map<string, LocationDetail>(),
        selectedId: undefined,
        error: undefined,
      });
      this.logger.info("location_store.load_completed", { locationCount: result.locations.length });
    } catch {
      if (generation !== this.generation) return;
      this.setSnapshot({
        ...EMPTY_SNAPSHOT,
        phase: "error",
        workspaceId: capturedId,
        error: {
          code: "novel-load-failed",
          message: "地点列表加载失败，请重试",
          retryable: true,
        },
      });
      this.logger.warn("location_store.load_failed");
    }
  }

  async loadDetail(locationId: string): Promise<void> {
    const capturedId = requireNonBlank(locationId, "Location id");
    if (this.snapshot.detailCache.has(capturedId)) return;
    const generation = this.generation;
    try {
      const result = await this.api.novel.locations.get(
        canonicalNovelQueryScope,
        capturedId as LocationId,
      );
      if (generation !== this.generation || result.location === undefined) return;
      const detail = captureDetail(result.location);
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

  invalidate(): Promise<void> {
    const workspaceId = this.snapshot.workspaceId;
    if (workspaceId === undefined) return Promise.resolve();
    return this.loadWorkspace(workspaceId);
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
    profile: location.authorNotes ?? "",
    relatedUnits: Object.freeze([]),
  });
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}
