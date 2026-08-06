/** Durable cache boundary for disposable Novel projections and rebuild targets. */
import type {
  NovelProjectionCacheEntry,
  NovelProjectionSourceSnapshot,
  NovelProjectionTarget,
} from "../projection/index.js";
import type { StoryOutlineTree } from "../model/index.js";
import type { NovelId } from "../identity/index.js";
import type { NovelRevision } from "../version/index.js";

export interface NovelProjectionTargetInventory {
  readonly storedCount: number;
  readonly corruptCount: number;
  readonly targets: readonly NovelProjectionTarget[];
}

export interface ReplaceNovelProjectionCacheInput {
  readonly novelId: NovelId;
  readonly rebuildRevision: NovelRevision;
  readonly entries: readonly NovelProjectionCacheEntry[];
}

export interface PutNovelProjectionCacheInput {
  readonly novelId: NovelId;
  readonly rebuildRevision: NovelRevision;
  readonly entry: NovelProjectionCacheEntry;
}

export interface NovelProjectionPlanningContext {
  readonly outline: StoryOutlineTree;
  readonly source: NovelProjectionSourceSnapshot;
}

export interface NovelProjectionSourceReader {
  readProjectionContext(novelId: NovelId): Promise<NovelProjectionPlanningContext>;
}

export interface NovelProjectionStore {
  getEntry(
    novelId: NovelId,
    target: NovelProjectionTarget,
  ): Promise<NovelProjectionCacheEntry | undefined>;
  putEntry(input: PutNovelProjectionCacheInput): Promise<void>;
  deleteEntry(novelId: NovelId, target: NovelProjectionTarget): Promise<void>;
  inspectTargets(novelId: NovelId): Promise<NovelProjectionTargetInventory>;
  replaceCache(input: ReplaceNovelProjectionCacheInput): Promise<void>;
}
