import assert from "node:assert/strict";
import {
  FractionalOrderKeyFactory,
  ManuscriptCatalog,
  ManuscriptRepairCatalog,
  NovelProtocolValidationError,
  PublicationCatalog,
  captureManuscript,
  captureManuscriptAnchor,
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
const novelId = captureNovelId("novel_repair");
const publication = capturePublicationStructure({
  id: capturePublicationStructureId("publication_repair"),
  novelId,
});
const volume = capturePublicationVolume({
  id: capturePublicationVolumeId("volume_repair"),
  publicationId: publication.id,
  orderKey: first,
  title: "Volume",
});
const chapter = capturePublicationChapter({
  id: capturePublicationChapterId("chapter_repair"),
  publicationId: publication.id,
  volumeId: volume.id,
  orderKey: first,
  title: "Chapter",
});
const publicationCatalog = new PublicationCatalog({
  publication,
  volumes: [volume],
  chapters: [chapter],
});
const manuscript = captureManuscript({
  id: captureManuscriptId("manuscript_repair"),
  novelId,
  publicationId: publication.id,
});
const original = block("block_original", first, "Left");
const splitRight = block("block_split_right", second, "Right");
const retained = block("block_retained", third, "Merged");
const manuscriptCatalog = new ManuscriptCatalog(
  { manuscript, blocks: [retained, splitRight, original] },
  publicationCatalog,
);
const mergedBlockId = captureManuscriptBlockId("block_merged_source");
const deletedBlockId = captureManuscriptBlockId("block_deleted_source");
const mergedTombstone = tombstone({
  blockId: mergedBlockId,
  reason: "merged",
  replacementBlockId: retained.id,
});
const deletedTombstone = tombstone({
  blockId: deletedBlockId,
  reason: "deleted",
});
const redirects = [
  redirect(original.id, "after", splitRight.id, "after", "split", "automatic"),
  redirect(mergedBlockId, "before", retained.id, "before", "merge", "review-required"),
  redirect(mergedBlockId, "after", retained.id, "after", "merge", "review-required"),
  redirect(deletedBlockId, "before", original.id, "after", "manual-repair", "review-required"),
];
const repairs = new ManuscriptRepairCatalog(
  { tombstones: [deletedTombstone, mergedTombstone], redirects },
  manuscriptCatalog,
);

assert.deepEqual(repairs.resolveAnchor(anchor(original.id, "before")), {
  status: "active",
  source: anchor(original.id, "before"),
  anchor: anchor(original.id, "before"),
  reviewRequired: false,
  redirectCount: 0,
});
assert.deepEqual(repairs.resolveAnchor(anchor(original.id, "after")), {
  status: "redirected",
  source: anchor(original.id, "after"),
  anchor: anchor(splitRight.id, "after"),
  reviewRequired: false,
  redirectCount: 1,
});
assert.deepEqual(repairs.resolveAnchor(anchor(deletedBlockId, "before")), {
  status: "redirected",
  source: anchor(deletedBlockId, "before"),
  anchor: anchor(splitRight.id, "after"),
  reviewRequired: true,
  redirectCount: 2,
});
assert.deepEqual(repairs.resolveAnchor(anchor(mergedBlockId, "after")), {
  status: "redirected",
  source: anchor(mergedBlockId, "after"),
  anchor: anchor(retained.id, "after"),
  reviewRequired: true,
  redirectCount: 1,
});
assert.equal(
  repairs.resolveAnchor(anchor(deletedBlockId, "after")).status,
  "tombstoned",
);
assert.equal(
  repairs.resolveAnchor(anchor(captureManuscriptBlockId("missing"), "before")).status,
  "orphaned",
);
assert.equal(Object.isFrozen(repairs.getSnapshot()), true);
assert.equal(Object.isFrozen(repairs.getSnapshot().redirects), true);

for (const invalid of [
  {
    tombstones: [tombstone({ blockId: original.id, reason: "deleted" })],
    redirects: [],
  },
  {
    tombstones: [mergedTombstone],
    redirects: [
      redirect(mergedBlockId, "before", splitRight.id, "before", "merge", "review-required"),
    ],
  },
  {
    tombstones: [],
    redirects: [
      redirect(original.id, "before", splitRight.id, "after", "split", "automatic"),
    ],
  },
  {
    tombstones: [deletedTombstone],
    redirects: [
      redirect(deletedBlockId, "before", original.id, "before", "manual-repair", "review-required"),
      redirect(deletedBlockId, "before", splitRight.id, "before", "manual-repair", "review-required"),
    ],
  },
]) {
  assert.throws(
    () => new ManuscriptRepairCatalog(invalid, manuscriptCatalog),
    (error) => error instanceof NovelProtocolValidationError &&
      error.failure === "invalid_manuscript_repair",
  );
}

const cycleLeftId = captureManuscriptBlockId("cycle_left");
const cycleRightId = captureManuscriptBlockId("cycle_right");
assert.throws(
  () => new ManuscriptRepairCatalog({
    tombstones: [
      tombstone({ blockId: cycleLeftId, reason: "deleted" }),
      tombstone({ blockId: cycleRightId, reason: "deleted" }),
    ],
    redirects: [
      redirect(cycleLeftId, "before", cycleRightId, "before", "manual-repair", "review-required"),
      redirect(cycleRightId, "before", cycleLeftId, "before", "manual-repair", "review-required"),
    ],
  }, manuscriptCatalog),
  NovelProtocolValidationError,
);

assert.throws(
  () => captureManuscriptBlockTombstone({
    ...deletedTombstone,
    replacementBlockId: original.id,
  }),
  NovelProtocolValidationError,
);
assert.throws(
  () => captureManuscriptAnchorRedirect({
    ...redirects[0],
    review: "review-required",
  }),
  NovelProtocolValidationError,
);

function block(id, orderKey, text) {
  return captureParagraphBlock({
    id: captureManuscriptBlockId(id),
    manuscriptId: manuscript.id,
    chapterId: chapter.id,
    orderKey,
    text,
  });
}

function anchor(blockId, boundary) {
  return captureManuscriptAnchor({ blockId, boundary });
}

function tombstone({ blockId, reason, replacementBlockId }) {
  return captureManuscriptBlockTombstone({
    blockId,
    manuscriptId: manuscript.id,
    formerChapterId: chapter.id,
    formerOrderKey: second,
    reason,
    ...(replacementBlockId === undefined ? {} : { replacementBlockId }),
  });
}

function redirect(sourceId, sourceBoundary, targetId, targetBoundary, reason, review) {
  return captureManuscriptAnchorRedirect({
    source: anchor(sourceId, sourceBoundary),
    target: anchor(targetId, targetBoundary),
    reason,
    review,
  });
}

console.log("novel manuscript repair smoke passed");
