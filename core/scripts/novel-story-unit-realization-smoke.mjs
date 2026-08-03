import assert from "node:assert/strict";
import {
  FractionalOrderKeyFactory,
  ManuscriptCatalog,
  ManuscriptRangeRepairValidator,
  ManuscriptRepairCatalog,
  NovelProtocolValidationError,
  PublicationCatalog,
  StoryOutlineTree,
  StoryUnitCompletionAdmissionValidator,
  captureManuscript,
  captureManuscriptAnchorRedirect,
  captureManuscriptBlockId,
  captureManuscriptBlockTombstone,
  captureManuscriptId,
  captureNovelId,
  captureNovelRevision,
  captureParagraphBlock,
  capturePublicationChapter,
  capturePublicationChapterId,
  capturePublicationStructure,
  capturePublicationStructureId,
  capturePublicationVolume,
  capturePublicationVolumeId,
  captureStoryOutline,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitConformanceResult,
  captureStoryUnitId,
  captureStoryUnitRealization,
} from "../dist/index.js";

const orders = new FractionalOrderKeyFactory();
const first = orders.initial();
const second = orders.after(first);
const third = orders.after(second);
const novelId = captureNovelId("novel_realization");
const currentRevision = captureNovelRevision("revision_current");
const oldRevision = captureNovelRevision("revision_old");
const outline = captureStoryOutline({
  id: captureStoryOutlineId("outline_realization"),
  novelId,
});
const root = captureStoryUnit({
  id: captureStoryUnitId("story_root"),
  outlineId: outline.id,
  orderKey: first,
  title: "Root",
  planningStatus: "ready",
  realizationStatus: "in-progress",
});
const leaf = captureStoryUnit({
  id: captureStoryUnitId("story_leaf"),
  outlineId: outline.id,
  parentId: root.id,
  orderKey: first,
  title: "Leaf",
  planningStatus: "ready",
  realizationStatus: "in-progress",
});
const tree = new StoryOutlineTree({ outline, units: [root, leaf] });

const publication = capturePublicationStructure({
  id: capturePublicationStructureId("publication_realization"),
  novelId,
});
const volume = capturePublicationVolume({
  id: capturePublicationVolumeId("volume_realization"),
  publicationId: publication.id,
  orderKey: first,
  title: "Volume",
});
const chapterOne = capturePublicationChapter({
  id: capturePublicationChapterId("chapter_realization_one"),
  publicationId: publication.id,
  volumeId: volume.id,
  orderKey: first,
  title: "Chapter One",
});
const chapterTwo = capturePublicationChapter({
  id: capturePublicationChapterId("chapter_realization_two"),
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
  id: captureManuscriptId("manuscript_realization"),
  novelId,
  publicationId: publication.id,
});
const firstBlock = block("block_first", chapterOne.id, first);
const secondBlock = block("block_second", chapterOne.id, second);
const movedLater = block("block_moved_later", chapterTwo.id, first);
const manuscriptCatalog = new ManuscriptCatalog({
  manuscript,
  blocks: [movedLater, secondBlock, firstBlock],
}, publicationCatalog);
const mergedId = captureManuscriptBlockId("block_merged_removed");
const deletedId = captureManuscriptBlockId("block_deleted_unresolved");
const repairs = new ManuscriptRepairCatalog({
  tombstones: [
    tombstone(mergedId, "merged", firstBlock.id),
    tombstone(deletedId, "deleted"),
  ],
  redirects: [
    redirect(mergedId, "before", firstBlock.id, "before", "merge", "review-required"),
    redirect(mergedId, "after", firstBlock.id, "after", "merge", "review-required"),
  ],
}, manuscriptCatalog);
const rangeValidator = new ManuscriptRangeRepairValidator(
  manuscriptCatalog,
  repairs,
);
const admission = new StoryUnitCompletionAdmissionValidator(
  tree,
  currentRevision,
  rangeValidator,
);

const mergedRange = range(mergedId, "before", mergedId, "after");
const warning = {
  type: "rhythm-mismatch",
  severity: "warning",
  note: "Accepted pacing variation.",
  manuscriptRanges: [mergedRange],
};
const admitted = admission.evaluate(realization({
  storyUnitId: leaf.id,
  ranges: [mergedRange],
  sourceRevision: currentRevision,
  validation: {
    status: "conforming",
    checkedNovelRevision: currentRevision,
    findings: [warning],
  },
}));
assert.equal(admitted.status, "admitted");
assert.equal(admitted.storyUnit.realizationStatus, "completed");
assert.equal(admitted.reviewedRepairCount, 1);
assert.deepEqual(admitted.resolvedRanges, [
  range(firstBlock.id, "before", firstBlock.id, "after"),
]);
assert.equal(Object.isFrozen(admitted), true);
assert.equal(Object.isFrozen(admitted.resolvedRanges), true);

assert.equal(admission.evaluate(realization({
  storyUnitId: leaf.id,
  ranges: [],
  sourceRevision: currentRevision,
  validation: conforming(currentRevision),
})).reason, "ranges-missing");

assert.equal(admission.evaluate(realization({
  storyUnitId: leaf.id,
  ranges: [range(firstBlock.id, "before", firstBlock.id, "after")],
  sourceRevision: oldRevision,
  validation: conforming(oldRevision),
})).reason, "realization-revision-stale");

assert.equal(admission.evaluate(realization({
  storyUnitId: leaf.id,
  ranges: [range(firstBlock.id, "before", firstBlock.id, "after")],
  sourceRevision: currentRevision,
  validation: {
    status: "stale",
    checkedNovelRevision: oldRevision,
    findings: [],
  },
})).reason, "validation-revision-stale");

assert.equal(admission.evaluate(realization({
  storyUnitId: leaf.id,
  ranges: [range(firstBlock.id, "before", firstBlock.id, "after")],
  sourceRevision: currentRevision,
  validation: {
    status: "non-conforming",
    checkedNovelRevision: currentRevision,
    findings: [{
      type: "missing-event",
      severity: "error",
      note: "Required event is missing.",
      manuscriptRanges: [],
    }],
  },
})).reason, "validation-not-conforming");

assert.equal(admission.evaluate(realization({
  storyUnitId: leaf.id,
  ranges: [range(deletedId, "before", deletedId, "after")],
  sourceRevision: currentRevision,
  validation: conforming(currentRevision),
})).reason, "range-unresolved");

assert.equal(admission.evaluate(realization({
  storyUnitId: leaf.id,
  ranges: [range(movedLater.id, "before", secondBlock.id, "after")],
  sourceRevision: currentRevision,
  validation: conforming(currentRevision),
})).reason, "range-inverted");

assert.equal(admission.evaluate(realization({
  storyUnitId: root.id,
  ranges: [range(firstBlock.id, "before", firstBlock.id, "after")],
  sourceRevision: currentRevision,
  validation: conforming(currentRevision),
})).reason, "story-unit-not-leaf");

assert.equal(admission.evaluate(realization({
  storyUnitId: captureStoryUnitId("missing_story_unit"),
  ranges: [range(firstBlock.id, "before", firstBlock.id, "after")],
  sourceRevision: currentRevision,
  validation: conforming(currentRevision),
})).reason, "story-unit-missing");

for (const invalid of [
  {
    status: "conforming",
    checkedNovelRevision: currentRevision,
    findings: [{
      type: "missing-event",
      severity: "error",
      note: "Error cannot be conforming.",
      manuscriptRanges: [],
    }],
  },
  {
    status: "non-conforming",
    checkedNovelRevision: currentRevision,
    findings: [warning],
  },
  {
    status: "pending",
    checkedNovelRevision: currentRevision,
    findings: [warning],
  },
]) {
  assert.throws(
    () => captureStoryUnitConformanceResult(invalid),
    (error) => error instanceof NovelProtocolValidationError &&
      error.failure === "invalid_story_unit_conformance",
  );
}

const duplicateRange = range(firstBlock.id, "before", firstBlock.id, "after");
assert.throws(
  () => captureStoryUnitRealization(realization({
    storyUnitId: leaf.id,
    ranges: [duplicateRange, duplicateRange],
    sourceRevision: currentRevision,
    validation: conforming(currentRevision),
  })),
  NovelProtocolValidationError,
);
assert.throws(
  () => captureStoryUnitRealization(realization({
    storyUnitId: leaf.id,
    ranges: [duplicateRange],
    sourceRevision: currentRevision,
    validation: conforming(oldRevision),
  })),
  NovelProtocolValidationError,
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
    formerOrderKey: third,
    reason,
    ...(replacementBlockId === undefined ? {} : { replacementBlockId }),
  });
}

function redirect(sourceId, sourceBoundary, targetId, targetBoundary, reason, review) {
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

function conforming(revision) {
  return {
    status: "conforming",
    checkedNovelRevision: revision,
    findings: [],
  };
}

function realization(value) {
  return value;
}

console.log("novel story unit realization smoke passed");
