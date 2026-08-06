import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  FractionalOrderKeyFactory,
  NovelOperationExecutor,
  NovelOperationPreconditionError,
  canonicalStringifyJson,
  captureNovelId,
  captureNovelOperationId,
  captureOrderKey,
  captureParagraph,
  captureParagraphId,
  captureStoryUnitId,
  createDefaultNovelOperationRegistry,
  createParagraphCreateOperation,
  createParagraphDeleteOperation,
  createParagraphOrderReplaceOperation,
  createParagraphStoryUnitReplaceOperation,
  createParagraphTextReplaceOperation,
} from "../dist/index.js";

class MemoryParagraphRepository {
  paragraphs = new Map();
  storyUnits = new Set();
  chapterParagraphIds = new Map();

  getParagraph(id) { return this.paragraphs.get(id); }
  listAllParagraphs() { return [...this.paragraphs.values()]; }
  listParagraphsByStoryUnit(storyUnitId) {
    return [...this.paragraphs.values()]
      .filter((value) => value.storyUnitId === storyUnitId)
      .sort((left, right) =>
        left.orderKey < right.orderKey ? -1 : left.orderKey > right.orderKey ? 1 : 0
      );
  }
  findParagraphAt(storyUnitId, orderKey) {
    return this.listParagraphsByStoryUnit(storyUnitId)
      .find((value) => value.orderKey === orderKey);
  }
  getParagraphDigest(id, field) {
    const paragraph = this.paragraphs.get(id);
    return paragraph === undefined ? undefined : digest(paragraph[field]);
  }
  insertParagraph(value) {
    if (this.paragraphs.has(value.id)) return false;
    this.paragraphs.set(value.id, value);
    return true;
  }
  replaceParagraph(value) {
    if (!this.paragraphs.has(value.id)) return false;
    this.paragraphs.set(value.id, value);
    return true;
  }
  deleteParagraph(id) { return this.paragraphs.delete(id); }
  removeParagraphFromChapters(paragraphId) {
    for (const [chapterId, ids] of this.chapterParagraphIds) {
      this.chapterParagraphIds.set(
        chapterId,
        ids.filter((id) => id !== paragraphId),
      );
    }
    return true;
  }
  hasStoryUnit(id) { return this.storyUnits.has(id); }
}

function digest(value) {
  return createHash("sha256")
    .update(canonicalStringifyJson(value))
    .digest("hex");
}

const novelId = captureNovelId("novel_paragraph_basic");
const storyUnitId = captureStoryUnitId("story_unit_paragraph_basic");
const otherStoryUnitId = captureStoryUnitId("story_unit_paragraph_other");
const paragraphId = captureParagraphId("paragraph_paragraph_basic");
const repository = new MemoryParagraphRepository();
repository.storyUnits.add(storyUnitId);
repository.storyUnits.add(otherStoryUnitId);
const executor = new NovelOperationExecutor(createDefaultNovelOperationRegistry());
const context = { paragraph: repository };
const paragraph = captureParagraph({
  id: paragraphId,
  storyUnitId,
  orderKey: new FractionalOrderKeyFactory().initial(),
  text: "Initial text",
});

executor.executeSynchronous(context, createParagraphCreateOperation({
  operationId: captureNovelOperationId("operation_paragraph_create"),
  paragraph,
}));
const expectedTextDigest = repository.getParagraphDigest(paragraphId, "text");
executor.executeSynchronous(context, createParagraphTextReplaceOperation({
  operationId: captureNovelOperationId("operation_paragraph_text_replace"),
  paragraphId,
  expectedTextDigest,
  text: "Final text",
}));
assert.equal(repository.getParagraph(paragraphId).text, "Final text");
assert.throws(
  () => executor.executeSynchronous(context, createParagraphTextReplaceOperation({
    operationId: captureNovelOperationId("operation_paragraph_text_stale"),
    paragraphId,
    expectedTextDigest,
    text: "Rejected text",
  })),
  (error) =>
    error instanceof NovelOperationPreconditionError &&
    error.failure === "field_digest_mismatch",
);
assert.equal(repository.getParagraph(paragraphId).text, "Final text");

const expectedOrderDigest = repository.getParagraphDigest(paragraphId, "orderKey");
const newOrderKey = captureOrderKey("40004000");
executor.executeSynchronous(context, createParagraphOrderReplaceOperation({
  operationId: captureNovelOperationId("operation_paragraph_order_replace"),
  paragraphId,
  expectedOrderDigest,
  orderKey: newOrderKey,
}));
assert.equal(repository.getParagraph(paragraphId).orderKey, newOrderKey);

const expectedStoryUnitDigest = repository.getParagraphDigest(paragraphId, "storyUnitId");
executor.executeSynchronous(context, createParagraphStoryUnitReplaceOperation({
  operationId: captureNovelOperationId("operation_paragraph_story_unit_replace"),
  paragraphId,
  expectedStoryUnitDigest,
  storyUnitId: otherStoryUnitId,
}));
assert.equal(repository.getParagraph(paragraphId).storyUnitId, otherStoryUnitId);

const finalTextDigest = repository.getParagraphDigest(paragraphId, "text");
const finalOrderDigest = repository.getParagraphDigest(paragraphId, "orderKey");
const finalStoryUnitDigest = repository.getParagraphDigest(paragraphId, "storyUnitId");
executor.executeSynchronous(context, createParagraphDeleteOperation({
  operationId: captureNovelOperationId("operation_paragraph_delete"),
  paragraphId,
  expectedTextDigest: finalTextDigest,
  expectedOrderDigest: finalOrderDigest,
  expectedStoryUnitDigest: finalStoryUnitDigest,
}));
assert.equal(repository.getParagraph(paragraphId), undefined);

console.log("novel paragraph basic operation smoke passed");
