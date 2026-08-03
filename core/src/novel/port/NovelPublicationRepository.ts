/** Synchronous transaction-local repository for Publication structure mutations. */
import type {
  NovelId,
  PublicationChapterId,
  PublicationStructureId,
  PublicationVolumeId,
} from "../identity/index.js";
import type {
  OrderKey,
  PublicationChapter,
  PublicationStructure,
  PublicationVolume,
} from "../model/index.js";

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
  insertVolume(volume: PublicationVolume): boolean;
  replaceVolume(volume: PublicationVolume): boolean;
  deleteVolume(id: PublicationVolumeId): boolean;
  getChapter(id: PublicationChapterId): PublicationChapter | undefined;
  listChapters(volumeId: PublicationVolumeId): readonly PublicationChapter[];
  findChapterAt(
    volumeId: PublicationVolumeId,
    orderKey: OrderKey,
  ): PublicationChapter | undefined;
  insertChapter(chapter: PublicationChapter): boolean;
  replaceChapter(chapter: PublicationChapter): boolean;
  deleteChapter(id: PublicationChapterId): boolean;
}

export interface NovelPublicationMutationContext {
  readonly publication: NovelMutablePublicationRepository;
}
