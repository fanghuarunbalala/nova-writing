/** Immutable Publication identities separate from StoryOutline and Paragraph content. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureNovelId,
  captureParagraphId,
  capturePublicationChapterId,
  capturePublicationStructureId,
  capturePublicationVolumeId,
  type NovelId,
  type ParagraphId,
  type PublicationChapterId,
  type PublicationStructureId,
  type PublicationVolumeId,
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
}

export interface PublicationChapter {
  readonly id: PublicationChapterId;
  readonly publicationId: PublicationStructureId;
  readonly volumeId: PublicationVolumeId;
  readonly orderKey: OrderKey;
  readonly title: string;
  readonly paragraphIds: readonly ParagraphId[];
}

const PUBLICATION_KEYS = new Set(["id", "novelId"]);
const VOLUME_KEYS = new Set(["id", "publicationId", "orderKey", "title"]);
const CHAPTER_KEYS = new Set([
  "id",
  "publicationId",
  "volumeId",
  "orderKey",
  "title",
  "paragraphIds",
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
  return Object.freeze({
    id: capturePublicationVolumeId(candidate.id),
    publicationId: capturePublicationStructureId(candidate.publicationId),
    orderKey: captureOrderKey(candidate.orderKey),
    title: captureTitle(candidate.title),
  });
}

export function capturePublicationChapter(value: unknown): PublicationChapter {
  const candidate = captureRecord(value, CHAPTER_KEYS);
  captureDenseArray(candidate.paragraphIds);
  return Object.freeze({
    id: capturePublicationChapterId(candidate.id),
    publicationId: capturePublicationStructureId(candidate.publicationId),
    volumeId: capturePublicationVolumeId(candidate.volumeId),
    orderKey: captureOrderKey(candidate.orderKey),
    title: captureTitle(candidate.title),
    paragraphIds: Object.freeze(candidate.paragraphIds.map(captureParagraphId)),
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
