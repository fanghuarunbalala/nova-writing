import assert from "node:assert/strict";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
  RandomStoryIdentityFactory,
  STORY_ENTITY_CHANGE_CATEGORY,
  captureCharacterId,
  captureLocationId,
  captureStoryEventStepId,
  captureStoryUnitEntityChange,
  captureStoryUnitEntityChangeId,
  captureStoryUnitEntityChanges,
  captureStoryUnitId,
} from "../dist/index.js";

assert.match(
  new RandomStoryIdentityFactory().createStoryUnitEntityChangeId(),
  /^entity_change_[a-f0-9]{32}$/u,
);

const storyUnitId = captureStoryUnitId("story_unit_entity_change");
const eventId = captureStoryEventStepId("story_event_entity_change");
const characterChange = captureStoryUnitEntityChange({
  id: captureStoryUnitEntityChangeId("entity_change_character"),
  storyUnitId,
  entityType: "character",
  entityId: captureCharacterId("character_protagonist"),
  relatedEntityId: captureCharacterId("character_rival"),
  category: STORY_ENTITY_CHANGE_CATEGORY.relationship,
  summary: "The protagonist now distrusts the rival.",
  sourceEventIds: [eventId],
});
const locationChange = captureStoryUnitEntityChange({
  id: captureStoryUnitEntityChangeId("entity_change_location"),
  storyUnitId,
  entityType: "location",
  entityId: captureLocationId("location_archive"),
  category: STORY_ENTITY_CHANGE_CATEGORY.environment,
  summary: "The archive is sealed after the fire.",
  sourceEventIds: [eventId],
});
assert.equal(Object.isFrozen(characterChange), true);
assert.equal(Object.isFrozen(characterChange.sourceEventIds), true);
const changes = captureStoryUnitEntityChanges(
  storyUnitId,
  [eventId],
  [locationChange, characterChange],
);
assert.deepEqual(changes.map((change) => change.id), [
  characterChange.id,
  locationChange.id,
]);

for (const invalid of [
  { ...characterChange, entityType: "artifact" },
  { ...characterChange, category: "unknown" },
  { ...characterChange, summary: "" },
  { ...characterChange, sourceEventIds: [eventId, eventId] },
  { ...characterChange, unknown: true },
]) {
  assertEntityChangeFailure(() => captureStoryUnitEntityChange(invalid));
}
for (const invalidChanges of [
  [characterChange, characterChange],
  [{ ...characterChange, storyUnitId: "story_unit_other" }],
  [{ ...characterChange, sourceEventIds: ["story_event_missing"] }],
]) {
  assertEntityChangeFailure(() =>
    captureStoryUnitEntityChanges(storyUnitId, [eventId], invalidChanges),
  );
}

console.log("novel story entity change smoke passed");

function assertEntityChangeFailure(invoke) {
  assert.throws(invoke, (error) => {
    assert.equal(error instanceof NovelProtocolValidationError, true);
    assert.equal(
      error.failure,
      NOVEL_PROTOCOL_FAILURE.invalidStoryEntityChange,
    );
    assert.equal(error.field, "storyEntityChange");
    return true;
  });
}
