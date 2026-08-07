/** Explicit-scope Paragraph query service with no implicit Draft selection. */
import {
  captureParagraphId,
  captureStoryUnitId,
  type ParagraphId,
  type StoryUnitId,
} from "../identity/index.js";
import type { NovelEntityVersion } from "../version/index.js";
import type {
  NovelParagraphQueryStore,
  ParagraphCatalogReadModel,
  ParagraphReadModel,
} from "../port/index.js";
import { captureNovelReadScope, type NovelReadScope } from "./NovelReadScope.js";

export class ParagraphQueryService {
  constructor(private readonly store: NovelParagraphQueryStore) {}

  getCatalog(scope: NovelReadScope): Promise<ParagraphCatalogReadModel | undefined> {
    return this.store.getCatalog(captureNovelReadScope(scope));
  }

  getParagraph(
    scope: NovelReadScope,
    id: ParagraphId,
  ): Promise<ParagraphReadModel | undefined> {
    return this.store.getParagraph(captureNovelReadScope(scope), captureParagraphId(id));
  }

  getParagraphVersion(
    scope: NovelReadScope,
    id: ParagraphId,
  ): Promise<NovelEntityVersion | undefined> {
    return this.store.getParagraphVersion(
      captureNovelReadScope(scope),
      captureParagraphId(id),
    );
  }

  listParagraphsByStoryUnit(
    scope: NovelReadScope,
    storyUnitId: StoryUnitId,
  ): Promise<readonly ParagraphReadModel[]> {
    return this.store.listParagraphsByStoryUnit(
      captureNovelReadScope(scope),
      captureStoryUnitId(storyUnitId),
    );
  }
}
