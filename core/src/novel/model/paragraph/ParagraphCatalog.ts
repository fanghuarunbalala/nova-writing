/** Validates and indexes Paragraphs by StoryUnit in deterministic order. */
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
import { compareOrderKeys } from "../outline/OrderKey.js";
import { captureParagraph, type Paragraph } from "./Paragraph.js";

export interface ParagraphCatalogSnapshot {
  readonly paragraphs: readonly Paragraph[];
}

const SNAPSHOT_KEYS = new Set(["paragraphs"]);
const EMPTY_PARAGRAPHS = Object.freeze([]) as readonly Paragraph[];

export class ParagraphCatalog {
  private readonly snapshot: ParagraphCatalogSnapshot;
  private readonly paragraphsById: ReadonlyMap<ParagraphId, Paragraph>;
  private readonly paragraphsByStoryUnitId: ReadonlyMap<
    StoryUnitId,
    readonly Paragraph[]
  >;

  constructor(value: unknown) {
    const captured = captureCatalogInput(value);
    const indexed = indexParagraphs(captured.paragraphs);
    this.snapshot = Object.freeze({
      paragraphs: captured.paragraphs,
    });
    this.paragraphsById = indexed.paragraphsById;
    this.paragraphsByStoryUnitId = indexed.paragraphsByStoryUnitId;
  }

  getSnapshot(): ParagraphCatalogSnapshot {
    return this.snapshot;
  }

  getParagraph(id: ParagraphId): Paragraph | undefined {
    return this.paragraphsById.get(captureParagraphId(id));
  }

  listParagraphs(storyUnitId: StoryUnitId): readonly Paragraph[] {
    return this.paragraphsByStoryUnitId.get(captureStoryUnitId(storyUnitId)) ??
      EMPTY_PARAGRAPHS;
  }

  listAllParagraphs(): readonly Paragraph[] {
    return this.snapshot.paragraphs;
  }
}

function captureCatalogInput(value: unknown): ParagraphCatalogSnapshot {
  const candidate = captureSnapshotRecord(value);
  captureDenseArray(candidate.paragraphs);
  return Object.freeze({
    paragraphs: Object.freeze(candidate.paragraphs.map(captureParagraph)),
  });
}

function indexParagraphs(paragraphs: readonly Paragraph[]) {
  const paragraphsById = new Map<ParagraphId, Paragraph>();
  const mutableByStoryUnitId = new Map<StoryUnitId, Paragraph[]>();
  const orderKeysByStoryUnitId = new Map<StoryUnitId, Set<string>>();
  for (const paragraph of paragraphs) {
    const orderKeys = orderKeysByStoryUnitId.get(paragraph.storyUnitId) ??
      new Set<string>();
    if (
      paragraphsById.has(paragraph.id) ||
      orderKeys.has(paragraph.orderKey)
    ) {
      throw invalidParagraphCatalog();
    }
    paragraphsById.set(paragraph.id, paragraph);
    orderKeys.add(paragraph.orderKey);
    orderKeysByStoryUnitId.set(paragraph.storyUnitId, orderKeys);
    const storyUnitParagraphs = mutableByStoryUnitId.get(paragraph.storyUnitId) ?? [];
    storyUnitParagraphs.push(paragraph);
    mutableByStoryUnitId.set(paragraph.storyUnitId, storyUnitParagraphs);
  }
  const paragraphsByStoryUnitId = new Map<
    StoryUnitId,
    readonly Paragraph[]
  >();
  for (const [storyUnitId, storyUnitParagraphs] of mutableByStoryUnitId) {
    paragraphsByStoryUnitId.set(
      storyUnitId,
      Object.freeze(
        storyUnitParagraphs.sort((left, right) =>
          compareOrderKeys(left.orderKey, right.orderKey)
        ),
      ),
    );
  }
  return { paragraphsById, paragraphsByStoryUnitId };
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
    throw invalidParagraphCatalog();
  }
  return value as Record<string, unknown>;
}

function captureDenseArray(value: unknown): asserts value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.keys(value).length !== value.length
  ) {
    throw invalidParagraphCatalog();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw invalidParagraphCatalog();
    }
  }
}

function invalidParagraphCatalog(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidParagraphCatalog,
    "paragraphCatalog",
  );
}
