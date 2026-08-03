/** Explicit-scope Manuscript and structural-repair query service. */
import { captureManuscriptBlockId, type ManuscriptBlockId } from "../identity/index.js";
import type {
  ManuscriptBlockReadModel,
  ManuscriptCatalogReadModel,
  NovelManuscriptQueryStore,
} from "../port/index.js";
import type { ManuscriptRepairCatalogSnapshot } from "../model/index.js";
import { captureNovelReadScope, type NovelReadScope } from "./NovelReadScope.js";

export class ManuscriptQueryService {
  constructor(private readonly store: NovelManuscriptQueryStore) {}

  getCatalog(scope: NovelReadScope): Promise<ManuscriptCatalogReadModel | undefined> {
    return this.store.getCatalog(captureNovelReadScope(scope));
  }

  getBlock(
    scope: NovelReadScope,
    id: ManuscriptBlockId,
  ): Promise<ManuscriptBlockReadModel | undefined> {
    return this.store.getBlock(captureNovelReadScope(scope), captureManuscriptBlockId(id));
  }

  listBlocks(scope: NovelReadScope): Promise<readonly ManuscriptBlockReadModel[]> {
    return this.store.listBlocks(captureNovelReadScope(scope));
  }

  getRepairs(scope: NovelReadScope): Promise<ManuscriptRepairCatalogSnapshot | undefined> {
    return this.store.getRepairs(captureNovelReadScope(scope));
  }
}
