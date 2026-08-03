import assert from "node:assert/strict";
import {
  FractionalOrderKeyFactory,
  ManuscriptCatalog,
  NovelProtocolValidationError,
  PublicationCatalog,
  captureManuscript,
  captureManuscriptBlockId,
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
const novelId = captureNovelId("novel_manuscript");
const publication = capturePublicationStructure({
  id: capturePublicationStructureId("publication_main"),
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
  id: captureManuscriptId("manuscript_main"),
  novelId,
  publicationId: publication.id,
});
const opening = captureParagraphBlock({
  id: captureManuscriptBlockId("block_opening"),
  manuscriptId: manuscript.id,
  chapterId: chapterOne.id,
  orderKey: first,
  text: "The door opened.",
});
const response = captureParagraphBlock({
  id: captureManuscriptBlockId("block_response"),
  manuscriptId: manuscript.id,
  chapterId: chapterOne.id,
  orderKey: second,
  text: "",
});
const later = captureParagraphBlock({
  id: captureManuscriptBlockId("block_later"),
  manuscriptId: manuscript.id,
  chapterId: chapterThree.id,
  orderKey: first,
  text: "Much later.",
});
const catalog = new ManuscriptCatalog(
  { manuscript, blocks: [later, response, opening] },
  publicationCatalog,
);

assert.deepEqual(catalog.listBlocks(chapterOne.id).map(({ id }) => id), [
  opening.id,
  response.id,
]);
assert.deepEqual(catalog.listAllBlocks().map(({ id }) => id), [
  opening.id,
  response.id,
  later.id,
]);
assert.deepEqual(catalog.getBlock(response.id), response);
assert.deepEqual(catalog.listBlocks(chapterTwo.id), []);
assert.equal(Object.isFrozen(catalog.getSnapshot()), true);
assert.equal(Object.isFrozen(catalog.listAllBlocks()), true);
assert.equal(Object.isFrozen(catalog.listBlocks(chapterOne.id)), true);
assert.equal(Object.isFrozen(opening), true);

for (const invalid of [
  { manuscript, blocks: [opening, { ...later, id: opening.id }] },
  { manuscript, blocks: [opening, { ...response, orderKey: opening.orderKey }] },
  {
    manuscript,
    blocks: [{ ...opening, manuscriptId: captureManuscriptId("other") }],
  },
  {
    manuscript,
    blocks: [{ ...opening, chapterId: capturePublicationChapterId("missing") }],
  },
]) {
  assert.throws(
    () => new ManuscriptCatalog(invalid, publicationCatalog),
    (error) => error instanceof NovelProtocolValidationError &&
      error.failure === "invalid_manuscript",
  );
}

assert.throws(
  () => new ManuscriptCatalog({
    manuscript: { ...manuscript, novelId: captureNovelId("other_novel") },
    blocks: [],
  }, publicationCatalog),
  NovelProtocolValidationError,
);
assert.throws(
  () => captureParagraphBlock({ ...opening, text: "invalid\u0000text" }),
  NovelProtocolValidationError,
);
assert.throws(
  () => captureManuscript({ ...manuscript, unexpected: true }),
  NovelProtocolValidationError,
);

const accessorBlocks = [];
Object.defineProperty(accessorBlocks, "0", {
  enumerable: true,
  get() { return opening; },
});
accessorBlocks.length = 1;
assert.throws(
  () => new ManuscriptCatalog({ manuscript, blocks: accessorBlocks }, publicationCatalog),
  NovelProtocolValidationError,
);

console.log("novel manuscript block smoke passed");
