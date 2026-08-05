import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  NovelOperationExecutor,
  NovelOperationPreconditionError,
  STORY_ENTITY_CHANGE_CATEGORY,
  canonicalStringifyJson,
  captureCharacterId,
  captureLocationId,
  captureNovelOperationId,
  captureNovelRevision,
  captureStoryUnitCharacterBinding,
  captureStoryUnitEntityChange,
  captureStoryUnitEntityChangeId,
  captureStoryUnitId,
  captureStoryUnitLocationBinding,
  createDefaultNovelOperationRegistry,
  createStoryUnitCharacterBindingDeleteOperation,
  createStoryUnitCharacterBindingPutOperation,
  createStoryUnitEntityChangeDeleteOperation,
  createStoryUnitEntityChangePutOperation,
  createStoryUnitLocationBindingDeleteOperation,
  createStoryUnitLocationBindingPutOperation,
} from "../dist/index.js";

class MemoryEvidenceRepository {
  characterBindings = new Map();
  locationBindings = new Map();
  changes = new Map();
  storyUnits = new Set();
  characters = new Set();
  locations = new Set();
  key(storyUnitId, entityId) { return `${storyUnitId}:${entityId}`; }
  listCharacterBindings() { return [...this.characterBindings.values()]; }
  getCharacterBinding(storyUnitId, characterId) { return this.characterBindings.get(this.key(storyUnitId, characterId)); }
  getCharacterBindingDigest(storyUnitId, characterId) { return digestValue(this.getCharacterBinding(storyUnitId, characterId)); }
  putCharacterBinding(value) { this.characterBindings.set(this.key(value.storyUnitId, value.characterId), value); }
  deleteCharacterBinding(storyUnitId, characterId) { return this.characterBindings.delete(this.key(storyUnitId, characterId)); }
  listLocationBindings() { return [...this.locationBindings.values()]; }
  getLocationBinding(storyUnitId, locationId) { return this.locationBindings.get(this.key(storyUnitId, locationId)); }
  getLocationBindingDigest(storyUnitId, locationId) { return digestValue(this.getLocationBinding(storyUnitId, locationId)); }
  putLocationBinding(value) { this.locationBindings.set(this.key(value.storyUnitId, value.locationId), value); }
  deleteLocationBinding(storyUnitId, locationId) { return this.locationBindings.delete(this.key(storyUnitId, locationId)); }
  listEntityChanges() { return [...this.changes.values()]; }
  getEntityChange(id) { return this.changes.get(id); }
  getEntityChangeDigest(id) { return digestValue(this.getEntityChange(id)); }
  putEntityChange(value) { this.changes.set(value.id, value); }
  deleteEntityChange(id) { return this.changes.delete(id); }
  hasStoryUnit(id) { return this.storyUnits.has(id); }
  hasCharacter(id) { return this.characters.has(id); }
  hasLocation(id) { return this.locations.has(id); }
}

function digestValue(value) {
  return value === undefined
    ? undefined
    : createHash("sha256").update(canonicalStringifyJson(value)).digest("hex");
}

const storyUnitId = captureStoryUnitId("story_unit_evidence_operations");
const characterId = captureCharacterId("character_evidence_operations");
const locationId = captureLocationId("location_evidence_operations");
const changeId = captureStoryUnitEntityChangeId("change_evidence_operations");
const repository = new MemoryEvidenceRepository();
repository.storyUnits.add(storyUnitId);
repository.characters.add(characterId);
repository.locations.add(locationId);
const executor = new NovelOperationExecutor(createDefaultNovelOperationRegistry());
const context = { projectionEvidence: repository };
let sequence = 0;
const operationId = () => captureNovelOperationId(`operation_evidence_${++sequence}`);

const characterBinding = captureStoryUnitCharacterBinding({ storyUnitId, characterId, note: "Initial" });
executor.executeSynchronous(context, createStoryUnitCharacterBindingPutOperation({ operationId: operationId(), binding: characterBinding }));
const characterDigest = repository.getCharacterBindingDigest(storyUnitId, characterId);
executor.executeSynchronous(context, createStoryUnitCharacterBindingPutOperation({
  operationId: operationId(),
  binding: captureStoryUnitCharacterBinding({ ...characterBinding, note: "Replaced" }),
  expectedRecordDigest: characterDigest,
}));
assert.throws(() => executor.executeSynchronous(context, createStoryUnitCharacterBindingPutOperation({
  operationId: operationId(), binding: characterBinding, expectedRecordDigest: characterDigest,
})), (error) => error instanceof NovelOperationPreconditionError && error.failure === "field_digest_mismatch");

const locationBinding = captureStoryUnitLocationBinding({ storyUnitId, locationId });
executor.executeSynchronous(context, createStoryUnitLocationBindingPutOperation({ operationId: operationId(), binding: locationBinding }));
const change = captureStoryUnitEntityChange({
  id: changeId,
  storyUnitId,
  entityType: "character",
  entityId: characterId,
  relatedEntityId: locationId,
  category: STORY_ENTITY_CHANGE_CATEGORY.condition,
  summary: "Changed",
  sourceEventIds: [],
});
executor.executeSynchronous(context, createStoryUnitEntityChangePutOperation({ operationId: operationId(), change }));
executor.executeSynchronous(context, createStoryUnitCharacterBindingDeleteOperation({
  operationId: operationId(), storyUnitId, characterId,
  expectedRecordDigest: repository.getCharacterBindingDigest(storyUnitId, characterId),
}));
executor.executeSynchronous(context, createStoryUnitLocationBindingDeleteOperation({
  operationId: operationId(), storyUnitId, locationId,
  expectedRecordDigest: repository.getLocationBindingDigest(storyUnitId, locationId),
}));
executor.executeSynchronous(context, createStoryUnitEntityChangeDeleteOperation({
  operationId: operationId(), id: changeId,
  expectedRecordDigest: repository.getEntityChangeDigest(changeId),
}));
assert.equal(repository.listCharacterBindings().length, 0);
assert.equal(repository.listLocationBindings().length, 0);
assert.equal(repository.listEntityChanges().length, 0);

console.log("novel projection evidence operation smoke passed");
