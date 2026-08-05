import assert from "node:assert/strict";
import {
  NovelProtocolValidationError,
  captureCharacterCurrentStateProjection,
  captureCharacterId,
  captureCharacterRelationshipProjection,
  captureEntityProfileReadinessProjection,
  captureLocationCurrentStateProjection,
  captureLocationId,
  captureNovelRevision,
  captureStoryUnitConformanceProjection,
  captureStoryUnitId,
  isNovelProjectionCurrent,
} from "../dist/index.js";

const characterId = captureCharacterId("character_projection");
const relatedCharacterId = captureCharacterId("character_related");
const locationId = captureLocationId("location_projection");
const targetStoryUnitId = captureStoryUnitId("story_unit_target");
const evidenceOne = captureStoryUnitId("story_unit_evidence_one");
const revision = captureNovelRevision("revision_projection");

const character = captureCharacterCurrentStateProjection({
  entityType: "character",
  characterId,
  atStoryUnitId: targetStoryUnitId,
  mode: "confirmed",
  sourceRevision: revision,
  summary: "The protagonist is injured but determined.",
  evidenceStoryUnitIds: [evidenceOne],
});
const location = captureLocationCurrentStateProjection({
  entityType: "location",
  locationId,
  atStoryUnitId: targetStoryUnitId,
  mode: "planned",
  sourceRevision: revision,
  summary: "The harbor is expected to remain inaccessible.",
  evidenceStoryUnitIds: [],
});
const readiness = captureEntityProfileReadinessProjection({
  entityType: "character",
  entityId: characterId,
  forStoryUnitId: targetStoryUnitId,
  sourceRevision: revision,
  status: "insufficient",
  missingInformation: ["motivation", "voice constraints"],
  evidenceStoryUnitIds: [targetStoryUnitId],
});
const relationship = captureCharacterRelationshipProjection({
  focusCharacterId: characterId,
  relatedCharacterId,
  atStoryUnitId: targetStoryUnitId,
  mode: "confirmed",
  sourceRevision: revision,
  summary: "Trust has weakened after the failed rescue.",
  evidenceStoryUnitIds: [evidenceOne],
});
const conformance = captureStoryUnitConformanceProjection({
  storyUnitId: targetStoryUnitId,
  sourceRevision: revision,
  freshness: "current",
  validationStatus: "conforming",
  warningCount: 1,
  errorCount: 0,
  evidenceStoryUnitIds: [targetStoryUnitId],
});

for (const projection of [
  character,
  location,
  readiness,
  relationship,
  conformance,
]) {
  assert.equal(Object.isFrozen(projection), true);
}
assert.equal(Object.isFrozen(character.evidenceStoryUnitIds), true);
assert.equal(Object.isFrozen(readiness.missingInformation), true);
assert.equal(isNovelProjectionCurrent(character, revision), true);
assert.equal(
  isNovelProjectionCurrent(character, captureNovelRevision("revision_new")),
  false,
);

for (const invalid of [
  () => captureCharacterCurrentStateProjection({
    ...character,
    entityType: "location",
  }),
  () => captureCharacterCurrentStateProjection({
    ...character,
    evidenceStoryUnitIds: [evidenceOne, evidenceOne],
  }),
  () => captureEntityProfileReadinessProjection({
    ...readiness,
    status: "sufficient",
  }),
  () => captureEntityProfileReadinessProjection({
    ...readiness,
    status: "insufficient",
    missingInformation: [],
  }),
  () => captureCharacterRelationshipProjection({
    ...relationship,
    relatedCharacterId: characterId,
  }),
  () => captureStoryUnitConformanceProjection({
    ...conformance,
    evidenceStoryUnitIds: [evidenceOne],
  }),
  () => captureStoryUnitConformanceProjection({
    ...conformance,
    warningCount: -1,
  }),
  () => captureStoryUnitConformanceProjection({
    ...conformance,
    validationStatus: "unknown",
  }),
  () => captureLocationCurrentStateProjection({
    ...location,
    unexpected: true,
  }),
]) {
  assert.throws(
    invalid,
    (error) => error instanceof NovelProtocolValidationError &&
      error.failure === "invalid_novel_projection",
  );
}

const accessorEvidence = [];
Object.defineProperty(accessorEvidence, "0", {
  enumerable: true,
  get() { return evidenceOne; },
});
accessorEvidence.length = 1;
assert.throws(
  () => captureCharacterCurrentStateProjection({
    ...character,
    evidenceStoryUnitIds: accessorEvidence,
  }),
  NovelProtocolValidationError,
);

console.log("novel projection model smoke passed");
