/** Immutable Paragraph content value owned by one StoryUnit with local order. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureParagraphId,
  captureStoryUnitId,
  type ParagraphId,
  type StoryUnitId,
} from "../../identity/index.js";
import { captureOrderKey, type OrderKey } from "../outline/OrderKey.js";

export interface Paragraph {
  readonly id: ParagraphId;
  readonly storyUnitId: StoryUnitId;
  readonly orderKey: OrderKey;
  readonly text: string;
}

const PARAGRAPH_KEYS = new Set(["id", "storyUnitId", "orderKey", "text"]);

export function captureParagraph(value: unknown): Paragraph {
  const candidate = captureRecord(value, PARAGRAPH_KEYS);
  return Object.freeze({
    id: captureParagraphId(candidate.id),
    storyUnitId: captureStoryUnitId(candidate.storyUnitId),
    orderKey: captureOrderKey(candidate.orderKey),
    text: captureParagraphText(candidate.text),
  });
}

export function captureParagraphText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 1_000_000 ||
    /\u0000/u.test(value)
  ) {
    throw invalidParagraph();
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
    throw invalidParagraph();
  }
  return value as Record<string, unknown>;
}

function invalidParagraph(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidParagraph,
    "paragraph",
  );
}
