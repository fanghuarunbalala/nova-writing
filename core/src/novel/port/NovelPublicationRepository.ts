/** Synchronous transaction-local repository for Publication structure mutations. */
import type {
  NovelId,
  ParagraphId,
  PublicationChapterId,
  PublicationStructureId,
  PublicationVolumeId,
} from "../identity/index.js";
import type {
  OrderKey,
  PublicationChapter,
  PublicationCatalogSnapshot,
  PublicationStructure,
  PublicationVolume,
} from "../model/index.js";
import type { NovelReadScope } from "../query/index.js";
import type { NovelEntityVersion } from "../version/index.js";

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
  /** 读取实体的当前版本（per-entity 乐观锁）。Current entity version. */
  getVolumeVersion(id: PublicationVolumeId): NovelEntityVersion | undefined;
  insertVolume(volume: PublicationVolume): boolean;
  replaceVolume(
    volume: PublicationVolume,
    expectedEntityVersion?: NovelEntityVersion,
  ): boolean;
  deleteVolume(
    id: PublicationVolumeId,
    expectedEntityVersion?: NovelEntityVersion,
  ): boolean;
  getChapter(id: PublicationChapterId): PublicationChapter | undefined;
  listChapters(volumeId: PublicationVolumeId): readonly PublicationChapter[];
  findChapterAt(
    volumeId: PublicationVolumeId,
    orderKey: OrderKey,
  ): PublicationChapter | undefined;
  getChapterDigest(id: PublicationChapterId): string | undefined;
  /** 读取实体的当前版本（per-entity 乐观锁）。Current entity version. */
  getChapterVersion(id: PublicationChapterId): NovelEntityVersion | undefined;
  insertChapter(chapter: PublicationChapter): boolean;
  replaceChapter(
    chapter: PublicationChapter,
    expectedEntityVersion?: NovelEntityVersion,
  ): boolean;
  deleteChapter(
    id: PublicationChapterId,
    expectedEntityVersion?: NovelEntityVersion,
  ): boolean;
  listChapterParagraphIds(chapterId: PublicationChapterId): readonly ParagraphId[];
  setChapterParagraphIds(
    chapterId: PublicationChapterId,
    paragraphIds: readonly ParagraphId[],
  ): boolean;
  getChapterIdByParagraphId(paragraphId: ParagraphId): PublicationChapterId | undefined;
  hasParagraph(paragraphId: ParagraphId): boolean;
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
  /** 读取实体当前版本（per-entity 乐观锁）。Current entity version. */
  getVolumeVersion(
    scope: NovelReadScope,
    id: PublicationVolumeId,
  ): Promise<NovelEntityVersion | undefined>;
  listVolumes(
    scope: NovelReadScope,
  ): Promise<readonly PublicationVolumeReadModel[]>;
  getChapter(
    scope: NovelReadScope,
    id: PublicationChapterId,
  ): Promise<PublicationChapterReadModel | undefined>;
  /** 读取实体当前版本（per-entity 乐观锁）。Current entity version. */
  getChapterVersion(
    scope: NovelReadScope,
    id: PublicationChapterId,
  ): Promise<NovelEntityVersion | undefined>;
  listChapters(
    scope: NovelReadScope,
    volumeId: PublicationVolumeId,
  ): Promise<readonly PublicationChapterReadModel[]>;
}
