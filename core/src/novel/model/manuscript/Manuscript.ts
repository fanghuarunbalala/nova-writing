/** Immutable Manuscript root and stable Paragraph Block value contracts. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureManuscriptBlockId,
  captureManuscriptId,
  captureNovelId,
  capturePublicationChapterId,
  capturePublicationStructureId,
  type ManuscriptBlockId,
  type ManuscriptId,
  type NovelId,
  type PublicationChapterId,
  type PublicationStructureId,
} from "../../identity/index.js";
import { captureOrderKey, type OrderKey } from "../outline/OrderKey.js";

export interface Manuscript {
  readonly id: ManuscriptId;
  readonly novelId: NovelId;
  readonly publicationId: PublicationStructureId;
}

export interface ParagraphBlock {
  readonly id: ManuscriptBlockId;
  readonly manuscriptId: ManuscriptId;
  readonly chapterId: PublicationChapterId;
  readonly orderKey: OrderKey;
  readonly text: string;
}

const MANUSCRIPT_KEYS = new Set(["id", "novelId", "publicationId"]);
const PARAGRAPH_BLOCK_KEYS = new Set([
  "id",
  "manuscriptId",
  "chapterId",
  "orderKey",
  "text",
]);

export function captureManuscript(value: unknown): Manuscript {
  const candidate = captureRecord(value, MANUSCRIPT_KEYS);
  return Object.freeze({
    id: captureManuscriptId(candidate.id),
    novelId: captureNovelId(candidate.novelId),
    publicationId: capturePublicationStructureId(candidate.publicationId),
  });
}

export function captureParagraphBlock(value: unknown): ParagraphBlock {
  const candidate = captureRecord(value, PARAGRAPH_BLOCK_KEYS);
  return Object.freeze({
    id: captureManuscriptBlockId(candidate.id),
    manuscriptId: captureManuscriptId(candidate.manuscriptId),
    chapterId: capturePublicationChapterId(candidate.chapterId),
    orderKey: captureOrderKey(candidate.orderKey),
    text: captureManuscriptText(candidate.text),
  });
}

export function captureManuscriptText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 1_000_000 ||
    /\u0000/u.test(value)
  ) {
    throw invalidManuscript();
  }
  return value;
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
    throw invalidManuscript();
  }
  return value as Record<string, unknown>;
}

function invalidManuscript(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidManuscript,
    "manuscript",
  );
}
