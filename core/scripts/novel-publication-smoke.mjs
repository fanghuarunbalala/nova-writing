import assert from "node:assert/strict";
import {
  FractionalOrderKeyFactory,
  NovelProtocolValidationError,
  PublicationCatalog,
  captureNovelId,
  capturePublicationChapter,
  capturePublicationChapterId,
  capturePublicationStructure,
  capturePublicationStructureId,
  capturePublicationVolume,
  capturePublicationVolumeId,
  captureStoryUnitId,
} from "../dist/index.js";

const orders = new FractionalOrderKeyFactory();
const first = orders.initial();
const second = orders.after(first);
const publication = capturePublicationStructure({
  id: capturePublicationStructureId("publication_main"),
  novelId: captureNovelId("novel_publication"),
});
const volumeOne = capturePublicationVolume({
  id: capturePublicationVolumeId("volume_one"),
  publicationId: publication.id,
  orderKey: first,
  title: "Volume One",
  primaryStoryUnitId: captureStoryUnitId("story_unit_volume_one"),
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
const catalog = new PublicationCatalog({
  publication,
  volumes: [volumeTwo, volumeOne],
  chapters: [chapterTwo, chapterOne],
});

assert.deepEqual(catalog.listVolumes().map(({ id }) => id), [
  volumeOne.id,
  volumeTwo.id,
]);
assert.deepEqual(catalog.listChapters(volumeOne.id).map(({ id }) => id), [
  chapterOne.id,
  chapterTwo.id,
]);
assert.deepEqual(catalog.getVolume(volumeOne.id), volumeOne);
assert.deepEqual(catalog.getChapter(chapterTwo.id), chapterTwo);
assert.equal(Object.isFrozen(catalog.getSnapshot()), true);
assert.equal(Object.isFrozen(catalog.listVolumes()), true);
assert.equal(Object.isFrozen(catalog.listChapters(volumeOne.id)), true);

for (const invalid of [
  {
    publication,
    volumes: [volumeOne, { ...volumeTwo, orderKey: volumeOne.orderKey }],
    chapters: [],
  },
  {
    publication,
    volumes: [volumeOne],
    chapters: [chapterOne, { ...chapterTwo, orderKey: chapterOne.orderKey }],
  },
  {
    publication,
    volumes: [volumeOne],
    chapters: [{ ...chapterOne, volumeId: capturePublicationVolumeId("missing") }],
  },
  {
    publication,
    volumes: [{ ...volumeOne, publicationId: capturePublicationStructureId("other") }],
    chapters: [],
  },
]) {
  assert.throws(
    () => new PublicationCatalog(invalid),
    (error) => error instanceof NovelProtocolValidationError &&
      error.failure === "invalid_publication",
  );
}

assert.throws(
  () => capturePublicationChapter({ ...chapterOne, title: " " }),
  NovelProtocolValidationError,
);

const accessorVolumes = [];
Object.defineProperty(accessorVolumes, "0", {
  enumerable: true,
  get() { return volumeOne; },
});
accessorVolumes.length = 1;
assert.throws(
  () => new PublicationCatalog({ publication, volumes: accessorVolumes, chapters: [] }),
  NovelProtocolValidationError,
);

console.log("novel publication smoke passed");
