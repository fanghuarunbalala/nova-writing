import assert from "node:assert/strict";
import {
  CHARACTER_PRESENCE,
  CHARACTER_STORY_ROLE,
  FractionalOrderKeyFactory,
  LEAF_STORY_UNIT_READINESS_FINDING,
  LEAF_STORY_UNIT_READINESS_STATUS,
  LOCATION_STORY_ROLE,
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
  RHYTHM_DIRECTION,
  STORY_ENTITY_CHANGE_CATEGORY,
  STORY_SETTING_MODE,
  STORY_UNIT_SCOPE,
  StoryOutlineTree,
  captureCharacterId,
  captureLeafStoryUnitPlan,
  captureLocationId,
  captureNovelId,
  captureRhythmBeatId,
  captureStoryEventStepId,
  captureStoryOutline,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitEntityChangeId,
  captureStoryUnitId,
  evaluateLeafStoryUnitReadiness,
} from "../dist/index.js";

const orderKeys = new FractionalOrderKeyFactory();
const outlineId = captureStoryOutlineId("outline_leaf_plan");
const parentId = captureStoryUnitId("story_unit_parent");
const leafId = captureStoryUnitId("story_unit_leaf");
const siblingLeafId = captureStoryUnitId("story_unit_sibling_leaf");
const outline = captureStoryOutline({
  id: outlineId,
  novelId: captureNovelId("novel_leaf_plan"),
});
const parent = captureStoryUnit({
  id: parentId,
  outlineId,
  orderKey: orderKeys.initial(),
  title: "Opening movement",
  scope: STORY_UNIT_SCOPE.arc,
  planningStatus: "outlined",
  realizationStatus: "pending",
});
const leaf = captureStoryUnit({
  id: leafId,
  outlineId,
  parentId,
  orderKey: orderKeys.initial(),
  title: "Archive confrontation",
  scope: STORY_UNIT_SCOPE.scene,
  planningStatus: "outlined",
  realizationStatus: "pending",
});
const siblingLeaf = captureStoryUnit({
  id: siblingLeafId,
  outlineId,
  parentId,
  orderKey: orderKeys.after(leaf.orderKey),
  title: "Aftermath",
  scope: STORY_UNIT_SCOPE.scene,
  planningStatus: "idea",
  realizationStatus: "pending",
});
const tree = new StoryOutlineTree({ outline, units: [parent, leaf, siblingLeaf] });

const protagonistId = captureCharacterId("character_leaf_protagonist");
const rivalId = captureCharacterId("character_leaf_rival");
const archiveId = captureLocationId("location_leaf_archive");
const eventId = captureStoryEventStepId("story_event_leaf_discovery");
const plan = captureLeafStoryUnitPlan({
  storyUnitId: leafId,
  settingMode: STORY_SETTING_MODE.located,
  time: { description: "The following morning" },
  characters: [
    {
      storyUnitId: leafId,
      characterId: protagonistId,
      involvement: {
        presence: CHARACTER_PRESENCE.present,
        roles: [
          CHARACTER_STORY_ROLE.pointOfView,
          CHARACTER_STORY_ROLE.participant,
        ],
      },
    },
    {
      storyUnitId: leafId,
      characterId: rivalId,
      involvement: {
        presence: CHARACTER_PRESENCE.offstage,
        roles: [CHARACTER_STORY_ROLE.affected],
      },
    },
  ],
  locations: [
    {
      storyUnitId: leafId,
      locationId: archiveId,
      involvement: { role: LOCATION_STORY_ROLE.primary, affected: true },
    },
  ],
  events: [
    {
      id: eventId,
      storyUnitId: leafId,
      orderKey: orderKeys.initial(),
      description: "The protagonist discovers the sealed ledger.",
    },
  ],
  rhythmBeats: [
    {
      id: captureRhythmBeatId("rhythm_beat_leaf_turn"),
      storyUnitId: leafId,
      orderKey: orderKeys.initial(),
      rhythm: RHYTHM_DIRECTION.turn,
      intensity: 4,
      relatedEventIds: [eventId],
    },
  ],
  entityChanges: [
    {
      id: captureStoryUnitEntityChangeId("entity_change_leaf_knowledge"),
      storyUnitId: leafId,
      entityType: "character",
      entityId: protagonistId,
      relatedEntityId: rivalId,
      category: STORY_ENTITY_CHANGE_CATEGORY.knowledge,
      summary: "The protagonist learns that the rival altered the archive.",
      sourceEventIds: [eventId],
    },
  ],
});
assert.equal(Object.isFrozen(plan), true);
for (const collection of [
  plan.characters,
  plan.locations,
  plan.events,
  plan.rhythmBeats,
  plan.entityChanges,
]) {
  assert.equal(Object.isFrozen(collection), true);
}

const ready = evaluateLeafStoryUnitReadiness(plan, {
  outline: tree,
  knownCharacterIds: [protagonistId, rivalId],
  knownLocationIds: [archiveId],
});
assert.equal(ready.status, LEAF_STORY_UNIT_READINESS_STATUS.ready);
assert.deepEqual(ready.findings, []);
assert.equal(Object.isFrozen(ready), true);
assert.equal(Object.isFrozen(ready.findings), true);

const incomplete = captureLeafStoryUnitPlan({
  storyUnitId: parentId,
  settingMode: STORY_SETTING_MODE.located,
  characters: [
    {
      storyUnitId: parentId,
      characterId: captureCharacterId("character_unknown"),
    },
  ],
  locations: [],
  events: [],
  rhythmBeats: [],
  entityChanges: [],
});
const incompleteResult = evaluateLeafStoryUnitReadiness(incomplete, {
  outline: tree,
  knownCharacterIds: [protagonistId, rivalId],
  knownLocationIds: [archiveId],
});
assert.equal(
  incompleteResult.status,
  LEAF_STORY_UNIT_READINESS_STATUS.notReady,
);
assert.deepEqual(
  incompleteResult.findings.map((finding) => finding.code),
  [
    LEAF_STORY_UNIT_READINESS_FINDING.storyUnitNotLeaf,
    LEAF_STORY_UNIT_READINESS_FINDING.storyTimeMissing,
    LEAF_STORY_UNIT_READINESS_FINDING.storyEventMissing,
    LEAF_STORY_UNIT_READINESS_FINDING.locatedPrimaryLocationRequired,
    LEAF_STORY_UNIT_READINESS_FINDING.unknownCharacterReference,
  ],
);

const independentWithPrimary = captureLeafStoryUnitPlan({
  ...plan,
  settingMode: STORY_SETTING_MODE.locationIndependent,
});
assert.deepEqual(
  evaluateLeafStoryUnitReadiness(independentWithPrimary, {
    outline: tree,
    knownCharacterIds: [protagonistId, rivalId],
    knownLocationIds: [archiveId],
  }).findings.map((finding) => finding.code),
  [
    LEAF_STORY_UNIT_READINESS_FINDING.locationIndependentPrimaryLocationForbidden,
  ],
);

for (const invalid of [
  { ...plan, settingMode: "unknown" },
  { ...plan, unknown: true },
]) {
  assert.throws(() => captureLeafStoryUnitPlan(invalid), (error) => {
    assert.equal(error instanceof NovelProtocolValidationError, true);
    assert.equal(
      error.failure,
      NOVEL_PROTOCOL_FAILURE.invalidLeafStoryUnitPlan,
    );
    assert.equal(error.field, "leafStoryUnitPlan");
    return true;
  });
}
assert.throws(() => captureLeafStoryUnitPlan({ ...plan, events: undefined }), (error) => {
  assert.equal(error instanceof NovelProtocolValidationError, true);
  assert.equal(error.failure, NOVEL_PROTOCOL_FAILURE.invalidStoryEvent);
  assert.equal(error.field, "storyEventStep");
  return true;
});

console.log("novel leaf story unit plan smoke passed");
