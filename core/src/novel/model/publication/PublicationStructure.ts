/** Immutable Publication identities separate from StoryOutline and Manuscript content. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureNovelId,
  capturePublicationChapterId,
  capturePublicationStructureId,
  capturePublicationVolumeId,
  captureStoryUnitId,
  type NovelId,
  type PublicationChapterId,
  type PublicationStructureId,
  type PublicationVolumeId,
  type StoryUnitId,
} from "../../identity/index.js";
import { captureOrderKey, type OrderKey } from "../outline/OrderKey.js";

export interface PublicationStructure {
  readonly id: PublicationStructureId;
  readonly novelId: NovelId;
}

export interface PublicationVolume {
  readonly id: PublicationVolumeId;
  readonly publicationId: PublicationStructureId;
  readonly orderKey: OrderKey;
  readonly title: string;
  readonly primaryStoryUnitId?: StoryUnitId;
}

export interface PublicationChapter {
  readonly id: PublicationChapterId;
  readonly publicationId: PublicationStructureId;
  readonly volumeId: PublicationVolumeId;
  readonly orderKey: OrderKey;
  readonly title: string;
}

const PUBLICATION_KEYS = new Set(["id", "novelId"]);
const VOLUME_KEYS = new Set([
  "id",
  "publicationId",
  "orderKey",
  "title",
  "primaryStoryUnitId",
]);
const CHAPTER_KEYS = new Set([
  "id",
  "publicationId",
  "volumeId",
  "orderKey",
  "title",
]);

export function capturePublicationStructure(value: unknown): PublicationStructure {
  const candidate = captureRecord(value, PUBLICATION_KEYS);
  return Object.freeze({
    id: capturePublicationStructureId(candidate.id),
    novelId: captureNovelId(candidate.novelId),
  });
}

export function capturePublicationVolume(value: unknown): PublicationVolume {
  const candidate = captureRecord(value, VOLUME_KEYS);
  const primaryStoryUnitId = candidate.primaryStoryUnitId === undefined
    ? undefined
    : captureStoryUnitId(candidate.primaryStoryUnitId);
  return Object.freeze({
    id: capturePublicationVolumeId(candidate.id),
    publicationId: capturePublicationStructureId(candidate.publicationId),
    orderKey: captureOrderKey(candidate.orderKey),
    title: captureTitle(candidate.title),
    ...(primaryStoryUnitId === undefined ? {} : { primaryStoryUnitId }),
  });
}

export function capturePublicationChapter(value: unknown): PublicationChapter {
  const candidate = captureRecord(value, CHAPTER_KEYS);
  return Object.freeze({
    id: capturePublicationChapterId(candidate.id),
    publicationId: capturePublicationStructureId(candidate.publicationId),
    volumeId: capturePublicationVolumeId(candidate.volumeId),
    orderKey: captureOrderKey(candidate.orderKey),
    title: captureTitle(candidate.title),
  });
}

function captureRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> {
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
    Object.keys(value).some((key) => !allowedKeys.has(key))
  ) {
    throw invalidPublication();
  }
  return value as Record<string, unknown>;
}

function captureTitle(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 1_000 ||
    /\u0000/u.test(value)
  ) {
    throw invalidPublication();
  }
  return value;
}

function invalidPublication(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidPublication,
    "publication",
  );
}
