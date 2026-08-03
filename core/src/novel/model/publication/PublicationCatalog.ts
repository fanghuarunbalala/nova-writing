/** Validates and indexes ordered Volume and Chapter publication structure. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  capturePublicationChapterId,
  capturePublicationVolumeId,
  type PublicationChapterId,
  type PublicationVolumeId,
} from "../../identity/index.js";
import { compareOrderKeys } from "../outline/OrderKey.js";
import {
  capturePublicationChapter,
  capturePublicationStructure,
  capturePublicationVolume,
  type PublicationChapter,
  type PublicationStructure,
  type PublicationVolume,
} from "./PublicationStructure.js";

export interface PublicationCatalogSnapshot {
  readonly publication: PublicationStructure;
  readonly volumes: readonly PublicationVolume[];
  readonly chapters: readonly PublicationChapter[];
}

const SNAPSHOT_KEYS = new Set(["publication", "volumes", "chapters"]);
const EMPTY_CHAPTERS = Object.freeze([]) as readonly PublicationChapter[];

export class PublicationCatalog {
  private readonly snapshot: PublicationCatalogSnapshot;
  private readonly volumesById: ReadonlyMap<PublicationVolumeId, PublicationVolume>;
  private readonly chaptersById: ReadonlyMap<PublicationChapterId, PublicationChapter>;
  private readonly chaptersByVolumeId: ReadonlyMap<
    PublicationVolumeId,
    readonly PublicationChapter[]
  >;

  constructor(value: unknown) {
    const record = captureSnapshotRecord(value);
    captureDenseArray(record.volumes);
    captureDenseArray(record.chapters);
    const publication = capturePublicationStructure(record.publication);
    const volumes = record.volumes.map(capturePublicationVolume);
    const chapters = record.chapters.map(capturePublicationChapter);
    const indexed = indexPublication(publication, volumes, chapters);
    this.snapshot = Object.freeze({
      publication,
      volumes: indexed.volumes,
      chapters: indexed.chapters,
    });
    this.volumesById = indexed.volumesById;
    this.chaptersById = indexed.chaptersById;
    this.chaptersByVolumeId = indexed.chaptersByVolumeId;
  }

  getSnapshot(): PublicationCatalogSnapshot {
    return this.snapshot;
  }

  listVolumes(): readonly PublicationVolume[] {
    return this.snapshot.volumes;
  }

  getVolume(id: PublicationVolumeId): PublicationVolume | undefined {
    return this.volumesById.get(capturePublicationVolumeId(id));
  }

  listChapters(volumeId: PublicationVolumeId): readonly PublicationChapter[] {
    return this.chaptersByVolumeId.get(capturePublicationVolumeId(volumeId)) ??
      EMPTY_CHAPTERS;
  }

  getChapter(id: PublicationChapterId): PublicationChapter | undefined {
    return this.chaptersById.get(capturePublicationChapterId(id));
  }
}

function indexPublication(
  publication: PublicationStructure,
  volumeInputs: readonly PublicationVolume[],
  chapterInputs: readonly PublicationChapter[],
) {
  const volumesById = new Map<PublicationVolumeId, PublicationVolume>();
  const volumeOrderKeys = new Set<string>();
  for (const volume of volumeInputs) {
    if (
      volume.publicationId !== publication.id ||
      volumesById.has(volume.id) ||
      volumeOrderKeys.has(volume.orderKey)
    ) {
      throw invalidPublication();
    }
    volumesById.set(volume.id, volume);
    volumeOrderKeys.add(volume.orderKey);
  }
  const volumes = Object.freeze(
    [...volumesById.values()].sort((left, right) =>
      compareOrderKeys(left.orderKey, right.orderKey)
    ),
  );

  const chaptersById = new Map<PublicationChapterId, PublicationChapter>();
  const mutableChaptersByVolumeId = new Map<
    PublicationVolumeId,
    PublicationChapter[]
  >();
  const chapterOrderKeysByVolume = new Map<PublicationVolumeId, Set<string>>();
  for (const chapter of chapterInputs) {
    const orderKeys = chapterOrderKeysByVolume.get(chapter.volumeId) ??
      new Set<string>();
    if (
      chapter.publicationId !== publication.id ||
      !volumesById.has(chapter.volumeId) ||
      chaptersById.has(chapter.id) ||
      orderKeys.has(chapter.orderKey)
    ) {
      throw invalidPublication();
    }
    chaptersById.set(chapter.id, chapter);
    orderKeys.add(chapter.orderKey);
    chapterOrderKeysByVolume.set(chapter.volumeId, orderKeys);
    const volumeChapters = mutableChaptersByVolumeId.get(chapter.volumeId) ?? [];
    volumeChapters.push(chapter);
    mutableChaptersByVolumeId.set(chapter.volumeId, volumeChapters);
  }
  const chaptersByVolumeId = new Map<
    PublicationVolumeId,
    readonly PublicationChapter[]
  >();
  for (const [volumeId, chapters] of mutableChaptersByVolumeId) {
    chaptersByVolumeId.set(
      volumeId,
      Object.freeze(
        chapters.sort((left, right) =>
          compareOrderKeys(left.orderKey, right.orderKey)
        ),
      ),
    );
  }
  const chapters = Object.freeze(
    volumes.flatMap((volume) => chaptersByVolumeId.get(volume.id) ?? []),
  );
  return {
    volumes,
    chapters,
    volumesById,
    chaptersById,
    chaptersByVolumeId,
  };
}

function captureSnapshotRecord(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length > 0 ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (descriptor) => !("value" in descriptor) || !descriptor.enumerable,
    ) ||
    Object.keys(value).some((key) => !SNAPSHOT_KEYS.has(key))
  ) {
    throw invalidPublication();
  }
  return value as Record<string, unknown>;
}

function captureDenseArray(value: unknown): asserts value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.keys(value).length !== value.length
  ) {
    throw invalidPublication();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw invalidPublication();
    }
  }
}

function invalidPublication(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidPublication,
    "publication",
  );
}
