/** Synchronous transaction-local repository for Publication structure mutations. */
import type {
  NovelId,
  PublicationChapterId,
  PublicationStructureId,
  PublicationVolumeId,
  StoryUnitId,
} from "../identity/index.js";
import type {
  OrderKey,
  PublicationChapter,
  PublicationCatalogSnapshot,
  PublicationStructure,
  PublicationVolume,
} from "../model/index.js";
import type { NovelReadScope } from "../query/index.js";

export interface PublicationVolumeReadModel {
  readonly volume: PublicationVolume;
  readonly recordDigest: string;
}

export interface PublicationChapterReadModel {
  readonly chapter: PublicationChapter;
  readonly recordDigest: string;
}

export interface PublicationCatalogReadModel {
  readonly snapshot: PublicationCatalogSnapshot;
  readonly volumeDigests: Readonly<Record<string, string>>;
  readonly chapterDigests: Readonly<Record<string, string>>;
}

export interface NovelMutablePublicationRepository {
  getPublication(id: PublicationStructureId): PublicationStructure | undefined;
  findPublicationByNovelId(novelId: NovelId): PublicationStructure | undefined;
  insertPublication(publication: PublicationStructure): boolean;
  getVolume(id: PublicationVolumeId): PublicationVolume | undefined;
  listVolumes(publicationId: PublicationStructureId): readonly PublicationVolume[];
  findVolumeAt(
    publicationId: PublicationStructureId,
    orderKey: OrderKey,
  ): PublicationVolume | undefined;
  getVolumeDigest(id: PublicationVolumeId): string | undefined;
  insertVolume(volume: PublicationVolume): boolean;
  replaceVolume(volume: PublicationVolume): boolean;
  deleteVolume(id: PublicationVolumeId): boolean;
  getChapter(id: PublicationChapterId): PublicationChapter | undefined;
  listChapters(volumeId: PublicationVolumeId): readonly PublicationChapter[];
  findChapterAt(
    volumeId: PublicationVolumeId,
    orderKey: OrderKey,
  ): PublicationChapter | undefined;
  getChapterDigest(id: PublicationChapterId): string | undefined;
  insertChapter(chapter: PublicationChapter): boolean;
  replaceChapter(chapter: PublicationChapter): boolean;
  deleteChapter(id: PublicationChapterId): boolean;
  hasStoryUnit(id: StoryUnitId): boolean;
  hasManuscriptBlocks(chapterId: PublicationChapterId): boolean;
}

export interface NovelPublicationMutationContext {
  readonly publication: NovelMutablePublicationRepository;
}

export interface NovelPublicationQueryStore {
  getCatalog(scope: NovelReadScope): Promise<PublicationCatalogReadModel | undefined>;
  getVolume(
    scope: NovelReadScope,
    id: PublicationVolumeId,
  ): Promise<PublicationVolumeReadModel | undefined>;
  listVolumes(
    scope: NovelReadScope,
  ): Promise<readonly PublicationVolumeReadModel[]>;
  getChapter(
    scope: NovelReadScope,
    id: PublicationChapterId,
  ): Promise<PublicationChapterReadModel | undefined>;
  listChapters(
    scope: NovelReadScope,
    volumeId: PublicationVolumeId,
  ): Promise<readonly PublicationChapterReadModel[]>;
}
