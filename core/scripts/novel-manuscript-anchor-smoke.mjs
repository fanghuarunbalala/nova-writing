import assert from "node:assert/strict";
import {
  FractionalOrderKeyFactory,
  ManuscriptAnchorValidator,
  ManuscriptCatalog,
  NovelProtocolValidationError,
  PublicationCatalog,
  captureManuscript,
  captureManuscriptAnchor,
  captureManuscriptBlockId,
  captureManuscriptId,
  captureManuscriptRange,
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
const novelId = captureNovelId("novel_anchor");
const publication = capturePublicationStructure({
  id: capturePublicationStructureId("publication_anchor"),
  novelId,
});
const volumeOne = capturePublicationVolume({
  id: capturePublicationVolumeId("volume_one"),
  publicationId: publication.id,
  orderKey: first,
  title: "Volume One",
});
const volumeTwo = capturePublicationVolume({
  id: capturePublicationVolumeId("volume_two"),
  publicationId: publication.id,
  orderKey: second,
  title: "Volume Two",
});
const chapterOne = capturePublicationChapter({
  id: capturePublicationChapterId("chapter_one"),
  publicationId: publication.id,
  volumeId: volumeOne.id,
  orderKey: first,
  title: "Chapter One",
});
const chapterTwo = capturePublicationChapter({
  id: capturePublicationChapterId("chapter_two"),
  publicationId: publication.id,
  volumeId: volumeOne.id,
  orderKey: second,
  title: "Chapter Two",
});
const chapterThree = capturePublicationChapter({
  id: capturePublicationChapterId("chapter_three"),
  publicationId: publication.id,
  volumeId: volumeTwo.id,
  orderKey: first,
  title: "Chapter Three",
});
const publicationCatalog = new PublicationCatalog({
  publication,
  volumes: [volumeTwo, volumeOne],
  chapters: [chapterThree, chapterTwo, chapterOne],
});
const manuscript = captureManuscript({
  id: captureManuscriptId("manuscript_anchor"),
  novelId,
  publicationId: publication.id,
});
const opening = captureParagraphBlock({
  id: captureManuscriptBlockId("block_opening"),
  manuscriptId: manuscript.id,
  chapterId: chapterOne.id,
  orderKey: first,
  text: "Opening.",
});
const middle = captureParagraphBlock({
  id: captureManuscriptBlockId("block_middle"),
  manuscriptId: manuscript.id,
  chapterId: chapterTwo.id,
  orderKey: first,
  text: "Middle.",
});
const ending = captureParagraphBlock({
  id: captureManuscriptBlockId("block_ending"),
  manuscriptId: manuscript.id,
  chapterId: chapterThree.id,
  orderKey: first,
  text: "Ending.",
});
const manuscriptCatalog = new ManuscriptCatalog(
  { manuscript, blocks: [ending, middle, opening] },
  publicationCatalog,
);
const validator = new ManuscriptAnchorValidator(manuscriptCatalog);
const beforeOpening = captureManuscriptAnchor({
  blockId: opening.id,
  boundary: "before",
});
const afterOpening = captureManuscriptAnchor({
  blockId: opening.id,
  boundary: "after",
});
const beforeMiddle = captureManuscriptAnchor({
  blockId: middle.id,
  boundary: "before",
});
const afterEnding = captureManuscriptAnchor({
  blockId: ending.id,
  boundary: "after",
});

assert.deepEqual(validator.validateAnchor(beforeOpening), beforeOpening);
assert.equal(validator.compareAnchors(beforeOpening, afterOpening), -1);
assert.equal(validator.compareAnchors(afterOpening, beforeMiddle), -1);
assert.equal(validator.compareAnchors(afterEnding, afterEnding), 0);
assert.deepEqual(
  validator.validateRange({ start: beforeOpening, end: afterEnding }),
  captureManuscriptRange({ start: beforeOpening, end: afterEnding }),
);
assert.deepEqual(
  validator.validateRange({ start: afterOpening, end: beforeMiddle }),
  captureManuscriptRange({ start: afterOpening, end: beforeMiddle }),
);
assert.deepEqual(
  validator.validateRange({ start: beforeMiddle, end: beforeMiddle }),
  captureManuscriptRange({ start: beforeMiddle, end: beforeMiddle }),
);
assert.equal(Object.isFrozen(beforeOpening), true);
assert.equal(
  Object.isFrozen(captureManuscriptRange({ start: beforeOpening, end: afterEnding })),
  true,
);

assert.throws(
  () => captureManuscriptAnchor({ blockId: opening.id, boundary: "inside" }),
  (error) => error instanceof NovelProtocolValidationError &&
    error.failure === "invalid_manuscript_anchor",
);
assert.throws(
  () => captureManuscriptRange({
    start: { ...beforeOpening, unexpected: true },
    end: afterEnding,
  }),
  (error) => error instanceof NovelProtocolValidationError &&
    error.failure === "invalid_manuscript_range",
);
assert.throws(
  () => validator.validateAnchor({
    blockId: captureManuscriptBlockId("missing_block"),
    boundary: "before",
  }),
  (error) => error instanceof NovelProtocolValidationError &&
    error.failure === "invalid_manuscript_anchor",
);
assert.throws(
  () => validator.validateRange({ start: afterOpening, end: beforeOpening }),
  (error) => error instanceof NovelProtocolValidationError &&
    error.failure === "invalid_manuscript_range",
);
assert.throws(
  () => validator.validateRange({ start: afterEnding, end: beforeMiddle }),
  NovelProtocolValidationError,
);
assert.throws(
  () => validator.validateRange({
    start: beforeOpening,
    end: {
      blockId: captureManuscriptBlockId("missing_block"),
      boundary: "after",
    },
  }),
  (error) => error instanceof NovelProtocolValidationError &&
    error.failure === "invalid_manuscript_range",
);

const accessorAnchor = {};
Object.defineProperty(accessorAnchor, "blockId", {
  enumerable: true,
  get() { return opening.id; },
});
accessorAnchor.boundary = "before";
assert.throws(
  () => captureManuscriptAnchor(accessorAnchor),
  NovelProtocolValidationError,
);

console.log("novel manuscript anchor smoke passed");
