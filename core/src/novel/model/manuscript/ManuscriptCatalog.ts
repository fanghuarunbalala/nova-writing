/** Validates and indexes Paragraph Blocks in deterministic publication order. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureManuscriptBlockId,
  capturePublicationChapterId,
  type ManuscriptBlockId,
  type PublicationChapterId,
} from "../../identity/index.js";
import { compareOrderKeys } from "../outline/OrderKey.js";
import type { PublicationCatalog } from "../publication/index.js";
import {
  captureManuscript,
  captureParagraphBlock,
  type Manuscript,
  type ParagraphBlock,
} from "./Manuscript.js";

export interface ManuscriptCatalogSnapshot {
  readonly manuscript: Manuscript;
  readonly blocks: readonly ParagraphBlock[];
}

const SNAPSHOT_KEYS = new Set(["manuscript", "blocks"]);
const EMPTY_BLOCKS = Object.freeze([]) as readonly ParagraphBlock[];

export class ManuscriptCatalog {
  private readonly snapshot: ManuscriptCatalogSnapshot;
  private readonly blocksById: ReadonlyMap<ManuscriptBlockId, ParagraphBlock>;
  private readonly blocksByChapterId: ReadonlyMap<
    PublicationChapterId,
    readonly ParagraphBlock[]
  >;

  constructor(value: unknown, publication: PublicationCatalog) {
    const captured = captureCatalogInput(value);
    const indexed = indexBlocks(captured.manuscript, captured.blocks, publication);
    this.snapshot = Object.freeze({
      manuscript: captured.manuscript,
      blocks: Object.freeze(
        publication.listVolumes().flatMap((volume) =>
          publication.listChapters(volume.id).flatMap((chapter) =>
            indexed.blocksByChapterId.get(chapter.id) ?? []
          )
        ),
      ),
    });
    this.blocksById = indexed.blocksById;
    this.blocksByChapterId = indexed.blocksByChapterId;
  }

  getSnapshot(): ManuscriptCatalogSnapshot {
    return this.snapshot;
  }

  getBlock(id: ManuscriptBlockId): ParagraphBlock | undefined {
    return this.blocksById.get(captureManuscriptBlockId(id));
  }

  listBlocks(chapterId: PublicationChapterId): readonly ParagraphBlock[] {
    return this.blocksByChapterId.get(capturePublicationChapterId(chapterId)) ??
      EMPTY_BLOCKS;
  }

  listAllBlocks(): readonly ParagraphBlock[] {
    return this.snapshot.blocks;
  }
}

function captureCatalogInput(value: unknown): ManuscriptCatalogSnapshot {
  const candidate = captureSnapshotRecord(value);
  captureDenseArray(candidate.blocks);
  return Object.freeze({
    manuscript: captureManuscript(candidate.manuscript),
    blocks: Object.freeze(candidate.blocks.map(captureParagraphBlock)),
  });
}

function indexBlocks(
  manuscript: Manuscript,
  blocks: readonly ParagraphBlock[],
  publication: PublicationCatalog,
) {
  const publicationRoot = publication.getSnapshot().publication;
  if (
    manuscript.novelId !== publicationRoot.novelId ||
    manuscript.publicationId !== publicationRoot.id
  ) {
    throw invalidManuscript();
  }

  const blocksById = new Map<ManuscriptBlockId, ParagraphBlock>();
  const mutableBlocksByChapterId = new Map<
    PublicationChapterId,
    ParagraphBlock[]
  >();
  const orderKeysByChapterId = new Map<PublicationChapterId, Set<string>>();
  for (const block of blocks) {
    const orderKeys = orderKeysByChapterId.get(block.chapterId) ?? new Set<string>();
    if (
      block.manuscriptId !== manuscript.id ||
      publication.getChapter(block.chapterId) === undefined ||
      blocksById.has(block.id) ||
      orderKeys.has(block.orderKey)
    ) {
      throw invalidManuscript();
    }
    blocksById.set(block.id, block);
    orderKeys.add(block.orderKey);
    orderKeysByChapterId.set(block.chapterId, orderKeys);
    const chapterBlocks = mutableBlocksByChapterId.get(block.chapterId) ?? [];
    chapterBlocks.push(block);
    mutableBlocksByChapterId.set(block.chapterId, chapterBlocks);
  }

  const blocksByChapterId = new Map<
    PublicationChapterId,
    readonly ParagraphBlock[]
  >();
  for (const [chapterId, chapterBlocks] of mutableBlocksByChapterId) {
    blocksByChapterId.set(
      chapterId,
      Object.freeze(
        chapterBlocks.sort((left, right) =>
          compareOrderKeys(left.orderKey, right.orderKey)
        ),
      ),
    );
  }
  return { blocksById, blocksByChapterId };
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
    throw invalidManuscript();
  }
  return value as Record<string, unknown>;
}

function captureDenseArray(value: unknown): asserts value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.keys(value).length !== value.length
  ) {
    throw invalidManuscript();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw invalidManuscript();
    }
  }
}

function invalidManuscript(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidManuscript,
    "manuscript",
  );
}
