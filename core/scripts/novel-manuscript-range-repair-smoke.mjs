import assert from "node:assert/strict";
import {
  FractionalOrderKeyFactory,
  ManuscriptCatalog,
  ManuscriptRangeRepairValidator,
  ManuscriptRepairCatalog,
  NovelProtocolValidationError,
  PublicationCatalog,
  captureManuscript,
  captureManuscriptAnchorRedirect,
  captureManuscriptBlockId,
  captureManuscriptBlockTombstone,
  captureManuscriptId,
  captureNovelId,
  captureParagraphBlock,
  capturePublicationChapter,
  capturePublicationChapterId,
  capturePublicationStructure,
  capturePublicationStructureId,
  capturePublicationVolume,
  capturePublicationVolumeId,
} from "../dist/index.js";

const orders = new FractionalOrderKeyFactory();
const first = orders.initial();
const second = orders.after(first);
const third = orders.after(second);
const fourth = orders.after(third);
const novelId = captureNovelId("novel_range_repair");
const publication = capturePublicationStructure({
  id: capturePublicationStructureId("publication_range_repair"),
  novelId,
});
const volume = capturePublicationVolume({
  id: capturePublicationVolumeId("volume_range_repair"),
  publicationId: publication.id,
  orderKey: first,
  title: "Volume",
});
const chapterOne = capturePublicationChapter({
  id: capturePublicationChapterId("chapter_range_one"),
  publicationId: publication.id,
  volumeId: volume.id,
  orderKey: first,
  title: "Chapter One",
});
const chapterTwo = capturePublicationChapter({
  id: capturePublicationChapterId("chapter_range_two"),
  publicationId: publication.id,
  volumeId: volume.id,
  orderKey: second,
  title: "Chapter Two",
});
const publicationCatalog = new PublicationCatalog({
  publication,
  volumes: [volume],
  chapters: [chapterTwo, chapterOne],
});
const manuscript = captureManuscript({
  id: captureManuscriptId("manuscript_range_repair"),
  novelId,
  publicationId: publication.id,
});
const splitLeft = block("block_split_left", chapterOne.id, first);
const splitRight = block("block_split_right", chapterOne.id, second);
const chapterOneTail = block("block_chapter_tail", chapterOne.id, third);
const mergeTarget = block("block_merge_target", chapterOne.id, fourth);
const movedLater = block("block_moved_later", chapterTwo.id, first);
const catalog = new ManuscriptCatalog({
  manuscript,
  blocks: [movedLater, mergeTarget, chapterOneTail, splitRight, splitLeft],
}, publicationCatalog);

const mergedId = captureManuscriptBlockId("block_merged_removed");
const repairedDeleteId = captureManuscriptBlockId("block_deleted_repaired");
const unresolvedDeleteId = captureManuscriptBlockId("block_deleted_unresolved");
const tombstones = [
  tombstone(mergedId, "merged", mergeTarget.id),
  tombstone(repairedDeleteId, "deleted"),
  tombstone(unresolvedDeleteId, "deleted"),
];
const redirects = [
  redirect(splitLeft.id, "after", splitRight.id, "after", "split", "automatic"),
  redirect(mergedId, "before", mergeTarget.id, "before", "merge", "review-required"),
  redirect(mergedId, "after", mergeTarget.id, "after", "merge", "review-required"),
  redirect(repairedDeleteId, "before", splitLeft.id, "before", "manual-repair", "review-required"),
  redirect(repairedDeleteId, "after", splitLeft.id, "after", "manual-repair", "review-required"),
];
const repairs = new ManuscriptRepairCatalog({ tombstones, redirects }, catalog);
const validator = new ManuscriptRangeRepairValidator(catalog, repairs);

const ordinary = validator.resolve(range(
  splitLeft.id,
  "before",
  chapterOneTail.id,
  "after",
));
assert.equal(ordinary.status, "valid");
assert.equal(ordinary.reviewRequired, false);

const split = validator.resolve(range(
  splitLeft.id,
  "before",
  splitLeft.id,
  "after",
));
assert.equal(split.status, "valid");
assert.deepEqual(split.resolvedRange.end, {
  blockId: splitRight.id,
  boundary: "after",
});
assert.equal(split.end.redirectCount, 1);

const merge = validator.resolve(range(
  mergedId,
  "before",
  mergedId,
  "after",
));
assert.equal(merge.status, "review-required");
assert.deepEqual(merge.resolvedRange, {
  start: { blockId: mergeTarget.id, boundary: "before" },
  end: { blockId: mergeTarget.id, boundary: "after" },
});

const manual = validator.resolve(range(
  repairedDeleteId,
  "before",
  repairedDeleteId,
  "after",
));
assert.equal(manual.status, "review-required");
assert.equal(manual.start.reviewRequired, true);
assert.equal(manual.end.redirectCount, 2);

const unresolved = validator.resolve(range(
  unresolvedDeleteId,
  "before",
  unresolvedDeleteId,
  "after",
));
assert.equal(unresolved.status, "unresolved");
assert.equal(unresolved.start.status, "tombstoned");

const inverted = validator.resolve(range(
  movedLater.id,
  "before",
  chapterOneTail.id,
  "after",
));
assert.equal(inverted.status, "inverted");
assert.equal(inverted.reviewRequired, true);
assert.equal(Object.isFrozen(inverted), true);

const otherManuscript = captureManuscript({
  id: captureManuscriptId("other_manuscript"),
  novelId,
  publicationId: publication.id,
});
const otherCatalog = new ManuscriptCatalog(
  { manuscript: otherManuscript, blocks: [] },
  publicationCatalog,
);
assert.throws(
  () => new ManuscriptRangeRepairValidator(otherCatalog, repairs),
  (error) => error instanceof NovelProtocolValidationError &&
    error.failure === "invalid_manuscript_repair",
);

function block(id, chapterId, orderKey) {
  return captureParagraphBlock({
    id: captureManuscriptBlockId(id),
    manuscriptId: manuscript.id,
    chapterId,
    orderKey,
    text: id,
  });
}

function tombstone(blockId, reason, replacementBlockId) {
  return captureManuscriptBlockTombstone({
    blockId,
    manuscriptId: manuscript.id,
    formerChapterId: chapterOne.id,
    formerOrderKey: fourth,
    reason,
    ...(replacementBlockId === undefined ? {} : { replacementBlockId }),
  });
}

function redirect(
  sourceId,
  sourceBoundary,
  targetId,
  targetBoundary,
  reason,
  review,
) {
  return captureManuscriptAnchorRedirect({
    source: { blockId: sourceId, boundary: sourceBoundary },
    target: { blockId: targetId, boundary: targetBoundary },
    reason,
    review,
  });
}

function range(startId, startBoundary, endId, endBoundary) {
  return {
    start: { blockId: startId, boundary: startBoundary },
    end: { blockId: endId, boundary: endBoundary },
  };
}

console.log("novel manuscript range repair smoke passed");
