/** Explicit-scope Publication query service with no implicit Draft selection. */
import {
  capturePublicationChapterId,
  capturePublicationVolumeId,
  type PublicationChapterId,
  type PublicationVolumeId,
} from "../identity/index.js";
import type {
  NovelPublicationQueryStore,
  PublicationCatalogReadModel,
  PublicationChapterReadModel,
  PublicationVolumeReadModel,
} from "../port/index.js";
import { captureNovelReadScope, type NovelReadScope } from "./NovelReadScope.js";

export class PublicationQueryService {
  constructor(private readonly store: NovelPublicationQueryStore) {}

  getCatalog(scope: NovelReadScope): Promise<PublicationCatalogReadModel | undefined> {
    return this.store.getCatalog(captureNovelReadScope(scope));
  }

  getVolume(
    scope: NovelReadScope,
    id: PublicationVolumeId,
  ): Promise<PublicationVolumeReadModel | undefined> {
    return this.store.getVolume(
      captureNovelReadScope(scope),
      capturePublicationVolumeId(id),
    );
  }

  listVolumes(scope: NovelReadScope): Promise<readonly PublicationVolumeReadModel[]> {
    return this.store.listVolumes(captureNovelReadScope(scope));
  }

  getChapter(
    scope: NovelReadScope,
    id: PublicationChapterId,
  ): Promise<PublicationChapterReadModel | undefined> {
    return this.store.getChapter(
      captureNovelReadScope(scope),
      capturePublicationChapterId(id),
    );
  }

  listChapters(
    scope: NovelReadScope,
    volumeId: PublicationVolumeId,
  ): Promise<readonly PublicationChapterReadModel[]> {
    return this.store.listChapters(
      captureNovelReadScope(scope),
      capturePublicationVolumeId(volumeId),
    );
  }
}
