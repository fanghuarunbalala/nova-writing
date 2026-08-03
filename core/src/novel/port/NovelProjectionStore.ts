/** Durable cache boundary for disposable Novel projections and rebuild targets. */
import type {
  NovelProjectionCacheEntry,
  NovelProjectionSourceSnapshot,
  NovelProjectionTarget,
} from "../projection/index.js";
import type { StoryOutlineTree } from "../model/index.js";
import type { ManuscriptRangeRepairValidator } from "../validation/index.js";
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

export interface NovelProjectionPlanningContext {
  readonly outline: StoryOutlineTree;
  readonly source: NovelProjectionSourceSnapshot;
  readonly ranges: ManuscriptRangeRepairValidator;
}

export interface NovelProjectionSourceReader {
  readProjectionContext(novelId: NovelId): Promise<NovelProjectionPlanningContext>;
}

export interface NovelProjectionStore {
  inspectTargets(novelId: NovelId): Promise<NovelProjectionTargetInventory>;
  replaceCache(input: ReplaceNovelProjectionCacheInput): Promise<void>;
}
