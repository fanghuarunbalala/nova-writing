import assert from "node:assert/strict";
import {
  FractionalOrderKeyFactory,
  NOVEL_PROJECTION_MODE,
  NOVEL_PROJECTION_TARGET_KIND,
  NOVEL_RECOVERY_PHASE,
  NovelProjectionRecoveryService,
  StoryOutlineTree,
  captureCharacterId,
  captureNovelId,
  captureNovelRevision,
  captureParagraph,
  captureParagraphId,
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
const paragraph = captureParagraph({
  id: captureParagraphId("paragraph_projection_recovery"),
  storyUnitId,
  orderKey,
  text: "Recovery content",
});
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
        source: {
          currentRevision,
          characters: [],
          locations: [],
          entityChanges: [],
          paragraphs: [paragraph],
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
  replacement.entries[0].projection.warningCount,
  0,
);
console.log("novel projection recovery smoke passed");
