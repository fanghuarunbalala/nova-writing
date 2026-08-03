import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  FractionalOrderKeyFactory,
  NovelOperationExecutor,
  NovelOperationPreconditionError,
  canonicalStringifyJson,
  captureManuscript,
  captureManuscriptBlockId,
  captureManuscriptId,
  captureNovelId,
  captureNovelOperationId,
  captureParagraphBlock,
  capturePublicationChapterId,
  capturePublicationStructureId,
  createDefaultNovelOperationRegistry,
  createManuscriptBlockCreateOperation,
  createManuscriptBlockTextReplaceOperation,
  createManuscriptCreateOperation,
} from "../dist/index.js";

class MemoryManuscriptRepository {
  manuscripts = new Map();
  blocks = new Map();
  tombstones = new Map();
  redirects = new Map();
  publications = new Set();
  chapters = new Set();

  getManuscript(id) { return this.manuscripts.get(id); }
  findManuscriptByNovelId(novelId) {
    return [...this.manuscripts.values()].find((value) => value.novelId === novelId);
  }
  hasPublication(id) { return this.publications.has(id); }
  insertManuscript(value) {
    if (this.manuscripts.has(value.id)) return false;
    this.manuscripts.set(value.id, value);
    return true;
  }
  getBlock(id) { return this.blocks.get(id); }
  listBlocks(manuscriptId) {
    return [...this.blocks.values()].filter((value) => value.manuscriptId === manuscriptId);
  }
  getBlockDigest(id, field) {
    const block = this.blocks.get(id);
    return block === undefined ? undefined : digest(block[field]);
  }
  listBlocksInChapter(manuscriptId, chapterId) {
    return this.listBlocks(manuscriptId).filter((value) => value.chapterId === chapterId);
  }
  findBlockAt(manuscriptId, chapterId, orderKey) {
    return this.listBlocksInChapter(manuscriptId, chapterId)
      .find((value) => value.orderKey === orderKey);
  }
  hasPublicationChapter(id) { return this.chapters.has(id); }
  insertBlock(value) {
    if (this.blocks.has(value.id)) return false;
    this.blocks.set(value.id, value);
    return true;
  }
  replaceBlock(value) {
    if (!this.blocks.has(value.id)) return false;
    this.blocks.set(value.id, value);
    return true;
  }
  deleteBlock(id) { return this.blocks.delete(id); }
  getTombstone(id) { return this.tombstones.get(id); }
  listTombstones(manuscriptId) {
    return [...this.tombstones.values()].filter((value) => value.manuscriptId === manuscriptId);
  }
  insertTombstone(value) {
    if (this.tombstones.has(value.blockId)) return false;
    this.tombstones.set(value.blockId, value);
    return true;
  }
  getAnchorRedirect(source) { return this.redirects.get(`${source.blockId}:${source.boundary}`); }
  listAnchorRedirects() { return [...this.redirects.values()]; }
  insertAnchorRedirect(value) {
    const key = `${value.source.blockId}:${value.source.boundary}`;
    if (this.redirects.has(key)) return false;
    this.redirects.set(key, value);
    return true;
  }
}

function digest(value) {
  return createHash("sha256")
    .update(canonicalStringifyJson(value))
    .digest("hex");
}

const novelId = captureNovelId("novel_manuscript_basic");
const publicationId = capturePublicationStructureId("publication_manuscript_basic");
const chapterId = capturePublicationChapterId("chapter_manuscript_basic");
const manuscriptId = captureManuscriptId("manuscript_basic");
const blockId = captureManuscriptBlockId("block_manuscript_basic");
const repository = new MemoryManuscriptRepository();
repository.publications.add(publicationId);
repository.chapters.add(chapterId);
const executor = new NovelOperationExecutor(createDefaultNovelOperationRegistry());
const context = { manuscript: repository };
const manuscript = captureManuscript({ id: manuscriptId, novelId, publicationId });
const block = captureParagraphBlock({
  id: blockId,
  manuscriptId,
  chapterId,
  orderKey: new FractionalOrderKeyFactory().initial(),
  text: "Initial text",
});

executor.executeSynchronous(context, createManuscriptCreateOperation({
  operationId: captureNovelOperationId("operation_manuscript_create"),
  manuscript,
}));
executor.executeSynchronous(context, createManuscriptBlockCreateOperation({
  operationId: captureNovelOperationId("operation_manuscript_block_create"),
  block,
}));
const expectedTextDigest = repository.getBlockDigest(blockId, "text");
executor.executeSynchronous(context, createManuscriptBlockTextReplaceOperation({
  operationId: captureNovelOperationId("operation_manuscript_text_replace"),
  blockId,
  expectedTextDigest,
  text: "Final text",
}));
assert.equal(repository.getBlock(blockId).text, "Final text");
assert.throws(
  () => executor.executeSynchronous(context, createManuscriptBlockTextReplaceOperation({
    operationId: captureNovelOperationId("operation_manuscript_text_stale"),
    blockId,
    expectedTextDigest,
    text: "Rejected text",
  })),
  (error) =>
    error instanceof NovelOperationPreconditionError &&
    error.failure === "field_digest_mismatch",
);
assert.equal(repository.getBlock(blockId).text, "Final text");

console.log("novel manuscript basic operation smoke passed");
