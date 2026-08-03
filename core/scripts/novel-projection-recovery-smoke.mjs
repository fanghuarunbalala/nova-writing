import assert from "node:assert/strict";
import {
  FractionalOrderKeyFactory,
  ManuscriptCatalog,
  NOVEL_PROJECTION_MODE,
  NOVEL_PROJECTION_TARGET_KIND,
  NOVEL_RECOVERY_PHASE,
  NovelProjectionRecoveryService,
  ManuscriptRepairCatalog,
  PublicationCatalog,
  StoryOutlineTree,
  ManuscriptRangeRepairValidator,
  captureCharacterId,
  captureManuscript,
  captureManuscriptId,
  captureNovelId,
  captureNovelRevision,
  capturePublicationChapter,
  capturePublicationChapterId,
  capturePublicationStructure,
  capturePublicationStructureId,
  capturePublicationVolume,
  capturePublicationVolumeId,
  captureStoryOutline,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitId,
} from "../dist/index.js";

const novelId = captureNovelId("novel_projection_recovery");
const currentRevision = captureNovelRevision("revision_projection_recovery");
const storyUnitId = captureStoryUnitId("story_projection_recovery");
const orderKey = new FractionalOrderKeyFactory().initial();
const outlineSnapshot = captureStoryOutline({
  id: captureStoryOutlineId("outline_projection_recovery"),
  novelId,
});
const outline = new StoryOutlineTree({
  outline: outlineSnapshot,
  units: [captureStoryUnit({
    id: storyUnitId,
    outlineId: outlineSnapshot.id,
    orderKey,
    title: "Recovery unit",
    planningStatus: "ready",
    realizationStatus: "pending",
  })],
});
const publication = capturePublicationStructure({
  id: capturePublicationStructureId("publication_projection_recovery"),
  novelId,
});
const volume = capturePublicationVolume({
  id: capturePublicationVolumeId("volume_projection_recovery"),
  publicationId: publication.id,
  title: "Volume",
  orderKey,
});
const chapter = capturePublicationChapter({
  id: capturePublicationChapterId("chapter_projection_recovery"),
  publicationId: publication.id,
  volumeId: volume.id,
  title: "Chapter",
  orderKey,
});
const publicationCatalog = new PublicationCatalog({
  publication,
  volumes: [volume],
  chapters: [chapter],
});
const manuscript = captureManuscript({
  id: captureManuscriptId("manuscript_projection_recovery"),
  novelId,
  publicationId: publication.id,
});
const manuscriptCatalog = new ManuscriptCatalog({
  manuscript,
  blocks: [],
}, publicationCatalog);
const repairCatalog = new ManuscriptRepairCatalog(
  { tombstones: [], redirects: [] },
  manuscriptCatalog,
);
const ranges = new ManuscriptRangeRepairValidator(
  manuscriptCatalog,
  repairCatalog,
);
const validTarget = {
  kind: NOVEL_PROJECTION_TARGET_KIND.storyUnitConformance,
  storyUnitId,
};
const removedTarget = {
  kind: NOVEL_PROJECTION_TARGET_KIND.characterState,
  characterId: captureCharacterId("character_missing_projection_recovery"),
  atStoryUnitId: storyUnitId,
  mode: NOVEL_PROJECTION_MODE.confirmed,
};
let replacement;
const service = new NovelProjectionRecoveryService({
  sourceReader: {
    async readProjectionContext(receivedNovelId) {
      assert.equal(receivedNovelId, novelId);
      return {
        outline,
        ranges,
        source: {
          currentRevision,
          characters: [],
          locations: [],
          entityChanges: [],
          realizations: [],
          characterBindings: [],
          locationBindings: [],
        },
      };
    },
  },
  store: {
    async inspectTargets(receivedNovelId) {
      assert.equal(receivedNovelId, novelId);
      return {
        storedCount: 3,
        corruptCount: 1,
        targets: [validTarget, removedTarget],
      };
    },
    async replaceCache(input) {
      replacement = input;
    },
  },
  readinessPolicy: {
    evaluateCharacter() { return []; },
    evaluateLocation() { return []; },
  },
});

const result = await service.recover(novelId);
assert.deepEqual(result, {
  phase: NOVEL_RECOVERY_PHASE.projection,
  inspectedCount: 3,
  repairedCount: 1,
  removedCount: 2,
  retainedCount: 0,
  publishedCount: 0,
});
assert.equal(replacement.novelId, novelId);
assert.equal(replacement.rebuildRevision, currentRevision);
assert.equal(replacement.entries.length, 1);
assert.equal(replacement.entries[0].target.kind, validTarget.kind);
assert.equal(
  replacement.entries[0].projection.rangeStatuses.length,
  0,
);
console.log("novel projection recovery smoke passed");
