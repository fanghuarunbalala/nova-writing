import assert from "node:assert/strict";
import {
  CHARACTER_PRESENCE,
  CHARACTER_STORY_ROLE,
  LOCATION_STORY_ROLE,
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
  captureCharacterId,
  captureCharacterInvolvement,
  captureLocationId,
  captureLocationInvolvement,
  captureStoryUnitCharacterBinding,
  captureStoryUnitCharacterBindings,
  captureStoryUnitId,
  captureStoryUnitLocationBinding,
  captureStoryUnitLocationBindings,
} from "../dist/index.js";

const storyUnitId = captureStoryUnitId("story_unit_binding_smoke");
const protagonistId = captureCharacterId("character_protagonist");
const witnessId = captureCharacterId("character_witness");
const primaryLocationId = captureLocationId("location_archive");
const mentionedLocationId = captureLocationId("location_harbor");

const protagonist = captureStoryUnitCharacterBinding({
  storyUnitId,
  characterId: protagonistId,
  involvement: {
    presence: CHARACTER_PRESENCE.present,
    roles: [
      CHARACTER_STORY_ROLE.pointOfView,
      CHARACTER_STORY_ROLE.participant,
      CHARACTER_STORY_ROLE.affected,
    ],
  },
  note: "The scene follows the protagonist's interpretation.",
});
const witness = captureStoryUnitCharacterBinding({
  storyUnitId,
  characterId: witnessId,
  involvement: {
    presence: CHARACTER_PRESENCE.mentioned,
    roles: [],
  },
});
assert.equal(Object.isFrozen(protagonist), true);
assert.equal(Object.isFrozen(protagonist.involvement.roles), true);
assert.deepEqual(
  captureStoryUnitCharacterBindings(storyUnitId, [witness, protagonist]).map(
    (binding) => binding.characterId,
  ),
  [protagonistId, witnessId],
);

const primaryLocation = captureStoryUnitLocationBinding({
  storyUnitId,
  locationId: primaryLocationId,
  involvement: { role: LOCATION_STORY_ROLE.primary, affected: true },
});
const mentionedLocation = captureStoryUnitLocationBinding({
  storyUnitId,
  locationId: mentionedLocationId,
  involvement: { role: LOCATION_STORY_ROLE.mentioned, affected: false },
});
assert.deepEqual(
  captureStoryUnitLocationBindings(storyUnitId, [mentionedLocation, primaryLocation]).map(
    (binding) => binding.locationId,
  ),
  [primaryLocationId, mentionedLocationId],
);

for (const invalid of [
  { presence: "unknown", roles: [] },
  { presence: CHARACTER_PRESENCE.present, roles: ["unknown"] },
  {
    presence: CHARACTER_PRESENCE.offstage,
    roles: [CHARACTER_STORY_ROLE.pointOfView],
  },
  {
    presence: CHARACTER_PRESENCE.present,
    roles: [CHARACTER_STORY_ROLE.participant, CHARACTER_STORY_ROLE.participant],
  },
]) {
  assertBindingFailure(() => captureCharacterInvolvement(invalid));
}
for (const invalid of [
  { role: "unknown", affected: false },
  { role: LOCATION_STORY_ROLE.primary },
  { role: LOCATION_STORY_ROLE.primary, affected: "yes" },
]) {
  assertBindingFailure(() => captureLocationInvolvement(invalid));
}
for (const invalidBindings of [
  [protagonist, protagonist],
  [{ ...protagonist, storyUnitId: "story_unit_other" }],
]) {
  assertBindingFailure(() =>
    captureStoryUnitCharacterBindings(storyUnitId, invalidBindings),
  );
}
for (const invalidBindings of [
  [primaryLocation, primaryLocation],
  [{ ...primaryLocation, storyUnitId: "story_unit_other" }],
]) {
  assertBindingFailure(() =>
    captureStoryUnitLocationBindings(storyUnitId, invalidBindings),
  );
}

console.log("novel story binding smoke passed");

function assertBindingFailure(invoke) {
  assert.throws(invoke, (error) => {
    assert.equal(error instanceof NovelProtocolValidationError, true);
    assert.equal(error.failure, NOVEL_PROTOCOL_FAILURE.invalidStoryBinding);
    assert.equal(error.field, "storyBinding");
    return true;
  });
}
