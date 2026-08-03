import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  FractionalOrderKeyFactory,
  ManuscriptCatalog,
  ManuscriptRepairCatalog,
  NovelOperationExecutor,
  NovelOperationPreconditionError,
  NovelOperationRegistry,
  PublicationCatalog,
  canonicalStringifyJson,
  captureManuscript,
  captureManuscriptBlockId,
  captureManuscriptId,
  captureNovelId,
  captureNovelOperationId,
  captureParagraphBlock,
  capturePublicationChapter,
  capturePublicationChapterId,
  capturePublicationStructure,
  capturePublicationStructureId,
  capturePublicationVolume,
  capturePublicationVolumeId,
  compareOrderKeys,
  createManuscriptAnchorRepairOperation,
  createManuscriptBlockDeleteOperation,
  createManuscriptBlockMergeOperation,
  createManuscriptBlockMoveOperation,
  createManuscriptBlockSplitOperation,
  manuscriptAnchorKey,
  registerNovelManuscriptOperationHandlers,
} from "../dist/index.js";

class MemoryManuscriptRepository {
  constructor(manuscript, chapters, blocks) {
    this.manuscriptRoot = manuscript;
    this.chapters = new Set(chapters);
    this.blocks = new Map(blocks.map((block) => [block.id, block]));
    this.tombstones = new Map();
    this.redirects = new Map();
  }

  getManuscript(id) {
    return id === this.manuscriptRoot.id ? this.manuscriptRoot : undefined;
  }

  getBlock(id) {
    return this.blocks.get(id);
  }

  getBlockDigest(id, field) {
    const block = this.blocks.get(id);
    return block === undefined ? undefined : digest(block[field]);
  }

  listBlocksInChapter(manuscriptId, chapterId) {
    return [...this.blocks.values()]
      .filter((block) =>
        block.manuscriptId === manuscriptId && block.chapterId === chapterId
      )
      .sort((left, right) => compareOrderKeys(left.orderKey, right.orderKey));
  }

  findBlockAt(manuscriptId, chapterId, orderKey) {
    return this.listBlocksInChapter(manuscriptId, chapterId)
      .find((block) => block.orderKey === orderKey);
  }

  hasPublicationChapter(chapterId) {
    return this.chapters.has(chapterId);
  }

  insertBlock(block) {
    if (this.blocks.has(block.id)) return false;
    this.blocks.set(block.id, block);
    return true;
  }

  replaceBlock(block) {
    if (!this.blocks.has(block.id)) return false;
    this.blocks.set(block.id, block);
    return true;
  }

  deleteBlock(id) {
    return this.blocks.delete(id);
  }

  getTombstone(id) {
    return this.tombstones.get(id);
  }

  insertTombstone(tombstone) {
    if (this.tombstones.has(tombstone.blockId)) return false;
    this.tombstones.set(tombstone.blockId, tombstone);
    return true;
  }

  getAnchorRedirect(source) {
    return this.redirects.get(manuscriptAnchorKey(source));
  }

  insertAnchorRedirect(redirect) {
    const key = manuscriptAnchorKey(redirect.source);
    if (this.redirects.has(key)) return false;
    this.redirects.set(key, redirect);
    return true;
  }

  snapshot() {
    return {
      blocks: [...this.blocks.values()].sort((left, right) =>
        left.id.localeCompare(right.id)
      ),
      tombstones: [...this.tombstones.values()].sort((left, right) =>
        left.blockId.localeCompare(right.blockId)
      ),
      redirects: [...this.redirects.values()].sort((left, right) =>
        manuscriptAnchorKey(left.source).localeCompare(
          manuscriptAnchorKey(right.source),
        )
      ),
    };
  }
}

const orders = new FractionalOrderKeyFactory();
const orderOne = orders.initial();
const orderTwo = orders.after(orderOne);
const orderThree = orders.after(orderTwo);
const orderFour = orders.after(orderThree);
const orderFive = orders.after(orderFour);
const splitRightOrder = orders.between(orderOne, orderThree);
const novelId = captureNovelId("novel_manuscript_operations");
const publication = capturePublicationStructure({
  id: capturePublicationStructureId("publication_operations"),
  novelId,
});
const volume = capturePublicationVolume({
  id: capturePublicationVolumeId("volume_operations"),
  publicationId: publication.id,
  orderKey: orderOne,
  title: "Volume",
});
const chapterOne = capturePublicationChapter({
  id: capturePublicationChapterId("chapter_one"),
  publicationId: publication.id,
  volumeId: volume.id,
  orderKey: orderOne,
  title: "Chapter One",
});
const chapterTwo = capturePublicationChapter({
  id: capturePublicationChapterId("chapter_two"),
  publicationId: publication.id,
  volumeId: volume.id,
  orderKey: orderTwo,
  title: "Chapter Two",
});
const publicationCatalog = new PublicationCatalog({
  publication,
  volumes: [volume],
  chapters: [chapterTwo, chapterOne],
});
const manuscript = captureManuscript({
  id: captureManuscriptId("manuscript_operations"),
  novelId,
  publicationId: publication.id,
});
const splitSource = block("block_split_source", chapterOne.id, orderOne, "AlphaBeta");
const moved = block("block_moved", chapterOne.id, orderTwo, "Move me");
const mergeLeft = block("block_merge_left", chapterOne.id, orderThree, "Left");
const mergeRight = block("block_merge_right", chapterOne.id, orderFour, "Right");
const deleted = block("block_deleted", chapterOne.id, orderFive, "Delete me");
const initialBlocks = [splitSource, moved, mergeLeft, mergeRight, deleted];

let operationNumber = 0;
function operationId(label) {
  operationNumber += 1;
  return captureNovelOperationId(`${label}_${operationNumber}`);
}

const splitRight = block(
  "block_split_right",
  chapterOne.id,
  splitRightOrder,
  "Beta",
);
const operations = [
  createManuscriptBlockMoveOperation({
    operationId: operationId("move"),
    blockId: moved.id,
    expectedChapterDigest: digest(moved.chapterId),
    expectedOrderDigest: digest(moved.orderKey),
    chapterId: chapterTwo.id,
    orderKey: orderOne,
  }),
  createManuscriptBlockSplitOperation({
    operationId: operationId("split"),
    blockId: splitSource.id,
    expectedTextDigest: digest(splitSource.text),
    leftText: "Alpha",
    rightBlock: splitRight,
  }),
  createManuscriptBlockMergeOperation({
    operationId: operationId("merge"),
    leftBlockId: mergeLeft.id,
    rightBlockId: mergeRight.id,
    expectedLeftTextDigest: digest(mergeLeft.text),
    expectedRightTextDigest: digest(mergeRight.text),
    expectedLeftChapterDigest: digest(mergeLeft.chapterId),
    expectedRightChapterDigest: digest(mergeRight.chapterId),
    expectedLeftOrderDigest: digest(mergeLeft.orderKey),
    expectedRightOrderDigest: digest(mergeRight.orderKey),
    text: "LeftRight",
  }),
  createManuscriptBlockDeleteOperation({
    operationId: operationId("delete"),
    blockId: deleted.id,
    expectedTextDigest: digest(deleted.text),
    expectedChapterDigest: digest(deleted.chapterId),
    expectedOrderDigest: digest(deleted.orderKey),
  }),
  createManuscriptAnchorRepairOperation({
    operationId: operationId("repair"),
    source: { blockId: deleted.id, boundary: "before" },
    target: { blockId: splitSource.id, boundary: "before" },
  }),
];

const registry = new NovelOperationRegistry();
registerNovelManuscriptOperationHandlers(registry);
const executor = new NovelOperationExecutor(registry);
const firstRepository = repository();
const secondRepository = repository();
for (const operation of operations) {
  executor.executeSynchronous({ manuscript: firstRepository }, operation);
  executor.executeSynchronous(
    { manuscript: secondRepository },
    JSON.parse(JSON.stringify(operation)),
  );
}
assert.deepEqual(firstRepository.snapshot(), secondRepository.snapshot());

assert.equal(firstRepository.getBlock(moved.id).chapterId, chapterTwo.id);
assert.equal(firstRepository.getBlock(moved.id).text, moved.text);
assert.equal(firstRepository.getBlock(splitSource.id).text, "Alpha");
assert.equal(firstRepository.getBlock(splitRight.id).text, "Beta");
assert.equal(firstRepository.getBlock(mergeLeft.id).text, "LeftRight");
assert.equal(firstRepository.getBlock(mergeRight.id), undefined);
assert.equal(firstRepository.getTombstone(mergeRight.id).reason, "merged");
assert.equal(firstRepository.getBlock(deleted.id), undefined);
assert.equal(firstRepository.getTombstone(deleted.id).reason, "deleted");

const activeCatalog = new ManuscriptCatalog(
  { manuscript, blocks: firstRepository.snapshot().blocks },
  publicationCatalog,
);
const repairCatalog = new ManuscriptRepairCatalog(
  {
    tombstones: firstRepository.snapshot().tombstones,
    redirects: firstRepository.snapshot().redirects,
  },
  activeCatalog,
);
assert.deepEqual(
  repairCatalog.resolveAnchor({ blockId: splitSource.id, boundary: "after" }),
  {
    status: "redirected",
    source: { blockId: splitSource.id, boundary: "after" },
    anchor: { blockId: splitRight.id, boundary: "after" },
    reviewRequired: false,
    redirectCount: 1,
  },
);
assert.equal(
  repairCatalog.resolveAnchor({ blockId: mergeRight.id, boundary: "before" })
    .reviewRequired,
  true,
);
assert.equal(
  repairCatalog.resolveAnchor({ blockId: deleted.id, boundary: "before" })
    .status,
  "redirected",
);
assert.equal(
  repairCatalog.resolveAnchor({ blockId: deleted.id, boundary: "after" })
    .status,
  "tombstoned",
);

const staleRepository = repository();
assert.throws(
  () => executor.executeSynchronous(
    { manuscript: staleRepository },
    createManuscriptBlockMoveOperation({
      operationId: operationId("stale_move"),
      blockId: moved.id,
      expectedChapterDigest: "stale_digest",
      expectedOrderDigest: digest(moved.orderKey),
      chapterId: chapterTwo.id,
      orderKey: orderOne,
    }),
  ),
  (error) => error instanceof NovelOperationPreconditionError &&
    error.failure === "field_digest_mismatch" &&
    error.fieldPath === "chapterId",
);
assert.deepEqual(staleRepository.snapshot(), repository().snapshot());

const nonAdjacentRepository = repository();
assert.throws(
  () => executor.executeSynchronous(
    { manuscript: nonAdjacentRepository },
    createManuscriptBlockMergeOperation({
      operationId: operationId("non_adjacent_merge"),
      leftBlockId: splitSource.id,
      rightBlockId: mergeLeft.id,
      expectedLeftTextDigest: digest(splitSource.text),
      expectedRightTextDigest: digest(mergeLeft.text),
      expectedLeftChapterDigest: digest(splitSource.chapterId),
      expectedRightChapterDigest: digest(mergeLeft.chapterId),
      expectedLeftOrderDigest: digest(splitSource.orderKey),
      expectedRightOrderDigest: digest(mergeLeft.orderKey),
      text: "Rejected",
    }),
  ),
  (error) => error instanceof NovelOperationPreconditionError &&
    error.failure === "domain_invariant",
);
assert.deepEqual(nonAdjacentRepository.snapshot(), repository().snapshot());

function repository() {
  return new MemoryManuscriptRepository(
    manuscript,
    [chapterOne.id, chapterTwo.id],
    initialBlocks,
  );
}

function block(id, chapterId, orderKey, text) {
  return captureParagraphBlock({
    id: captureManuscriptBlockId(id),
    manuscriptId: manuscript.id,
    chapterId,
    orderKey,
    text,
  });
}

function digest(value) {
  return createHash("sha256")
    .update(canonicalStringifyJson(value))
    .digest("hex");
}

console.log("novel manuscript operation smoke passed");
