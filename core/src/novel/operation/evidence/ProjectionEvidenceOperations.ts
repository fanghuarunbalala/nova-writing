/** Deterministic overwrite/delete Operations for authoritative projection evidence. */
import { canonicalStringifyJson, type JsonObject } from "../../../event/index.js";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelOperationPreconditionError,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureCharacterId,
  captureLocationId,
  captureStoryUnitEntityChangeId,
  captureStoryUnitId,
  type CharacterId,
  type LocationId,
  type NovelOperationId,
  type StoryUnitEntityChangeId,
  type StoryUnitId,
} from "../../identity/index.js";
import {
  captureStoryUnitCharacterBinding,
  captureStoryUnitEntityChange,
  captureStoryUnitLocationBinding,
  captureStoryUnitRealization,
  type StoryUnitCharacterBinding,
  type StoryUnitEntityChange,
  type StoryUnitLocationBinding,
  type StoryUnitRealization,
} from "../../model/index.js";
import type {
  NovelMutableProjectionEvidenceRepository,
  NovelProjectionEvidenceMutationContext,
} from "../../port/index.js";
import { captureNovelOperationVersion } from "../../version/index.js";
import {
  captureNovelOperation,
  type NovelOperation,
  type NovelOperationPrecondition,
} from "../NovelOperation.js";
import type { NovelOperationRegistry } from "../NovelOperationRegistry.js";

export const NOVEL_EVIDENCE_OPERATION_TYPE = {
  characterBindingPut: "story-unit-character-binding.put",
  characterBindingDelete: "story-unit-character-binding.delete",
  locationBindingPut: "story-unit-location-binding.put",
  locationBindingDelete: "story-unit-location-binding.delete",
  entityChangePut: "story-unit-entity-change.put",
  entityChangeDelete: "story-unit-entity-change.delete",
  realizationPut: "story-unit-realization.put",
  realizationDelete: "story-unit-realization.delete",
} as const;

const VERSION = captureNovelOperationVersion(1);
const STORY_UNIT = "story-unit";
const CHARACTER = "character";
const LOCATION = "location";
const CHARACTER_BINDING = "story-unit-character-binding";
const LOCATION_BINDING = "story-unit-location-binding";
const ENTITY_CHANGE = "story-unit-entity-change";
const REALIZATION = "story-unit-realization";

interface ValuePayload extends JsonObject { readonly value: JsonObject }
interface BindingIdentityPayload extends JsonObject {
  readonly storyUnitId: string;
  readonly entityId: string;
}
interface IdentityPayload extends JsonObject { readonly id: string }

export function createStoryUnitCharacterBindingPutOperation(input: {
  operationId: NovelOperationId;
  binding: StoryUnitCharacterBinding;
  expectedRecordDigest?: string;
}) {
  const value = captureStoryUnitCharacterBinding(input.binding);
  return putOperation(
    input.operationId,
    NOVEL_EVIDENCE_OPERATION_TYPE.characterBindingPut,
    value,
    CHARACTER_BINDING,
    value.characterId,
    input.expectedRecordDigest,
    [exists(STORY_UNIT, value.storyUnitId), exists(CHARACTER, value.characterId)],
  );
}

export function createStoryUnitCharacterBindingDeleteOperation(input: {
  operationId: NovelOperationId;
  storyUnitId: StoryUnitId;
  characterId: CharacterId;
  expectedRecordDigest: string;
}) {
  const storyUnitId = captureStoryUnitId(input.storyUnitId);
  const entityId = captureCharacterId(input.characterId);
  return deleteBindingOperation(
    input.operationId,
    NOVEL_EVIDENCE_OPERATION_TYPE.characterBindingDelete,
    CHARACTER_BINDING,
    storyUnitId,
    entityId,
    input.expectedRecordDigest,
  );
}

export function createStoryUnitLocationBindingPutOperation(input: {
  operationId: NovelOperationId;
  binding: StoryUnitLocationBinding;
  expectedRecordDigest?: string;
}) {
  const value = captureStoryUnitLocationBinding(input.binding);
  return putOperation(
    input.operationId,
    NOVEL_EVIDENCE_OPERATION_TYPE.locationBindingPut,
    value,
    LOCATION_BINDING,
    value.locationId,
    input.expectedRecordDigest,
    [exists(STORY_UNIT, value.storyUnitId), exists(LOCATION, value.locationId)],
  );
}

export function createStoryUnitLocationBindingDeleteOperation(input: {
  operationId: NovelOperationId;
  storyUnitId: StoryUnitId;
  locationId: LocationId;
  expectedRecordDigest: string;
}) {
  const storyUnitId = captureStoryUnitId(input.storyUnitId);
  const entityId = captureLocationId(input.locationId);
  return deleteBindingOperation(
    input.operationId,
    NOVEL_EVIDENCE_OPERATION_TYPE.locationBindingDelete,
    LOCATION_BINDING,
    storyUnitId,
    entityId,
    input.expectedRecordDigest,
  );
}

export function createStoryUnitEntityChangePutOperation(input: {
  operationId: NovelOperationId;
  change: StoryUnitEntityChange;
  expectedRecordDigest?: string;
}) {
  const value = captureStoryUnitEntityChange(input.change);
  return putOperation(
    input.operationId,
    NOVEL_EVIDENCE_OPERATION_TYPE.entityChangePut,
    value,
    ENTITY_CHANGE,
    value.id,
    input.expectedRecordDigest,
    [
      exists(STORY_UNIT, value.storyUnitId),
      exists(value.entityType, value.entityId),
      ...(value.relatedEntityId === undefined
        ? []
        : [exists("story-entity", value.relatedEntityId)]),
    ],
  );
}

export function createStoryUnitEntityChangeDeleteOperation(input: {
  operationId: NovelOperationId;
  id: StoryUnitEntityChangeId;
  expectedRecordDigest: string;
}) {
  const id = captureStoryUnitEntityChangeId(input.id);
  return deleteIdentityOperation(
    input.operationId,
    NOVEL_EVIDENCE_OPERATION_TYPE.entityChangeDelete,
    ENTITY_CHANGE,
    id,
    input.expectedRecordDigest,
  );
}

export function createStoryUnitRealizationPutOperation(input: {
  operationId: NovelOperationId;
  realization: StoryUnitRealization;
  expectedRecordDigest?: string;
}) {
  const value = captureStoryUnitRealization(input.realization);
  return putOperation(
    input.operationId,
    NOVEL_EVIDENCE_OPERATION_TYPE.realizationPut,
    value,
    REALIZATION,
    value.storyUnitId,
    input.expectedRecordDigest,
    [exists(STORY_UNIT, value.storyUnitId)],
  );
}

export function createStoryUnitRealizationDeleteOperation(input: {
  operationId: NovelOperationId;
  storyUnitId: StoryUnitId;
  expectedRecordDigest: string;
}) {
  const id = captureStoryUnitId(input.storyUnitId);
  return deleteIdentityOperation(
    input.operationId,
    NOVEL_EVIDENCE_OPERATION_TYPE.realizationDelete,
    REALIZATION,
    id,
    input.expectedRecordDigest,
  );
}

export function registerNovelProjectionEvidenceOperationHandlers<
  TContext extends NovelProjectionEvidenceMutationContext,
>(registry: NovelOperationRegistry<TContext>): void {
  const handlers: readonly [string, (store: NovelMutableProjectionEvidenceRepository, operation: NovelOperation) => void][] = [
    [NOVEL_EVIDENCE_OPERATION_TYPE.characterBindingPut, applyCharacterBindingPut],
    [NOVEL_EVIDENCE_OPERATION_TYPE.characterBindingDelete, applyCharacterBindingDelete],
    [NOVEL_EVIDENCE_OPERATION_TYPE.locationBindingPut, applyLocationBindingPut],
    [NOVEL_EVIDENCE_OPERATION_TYPE.locationBindingDelete, applyLocationBindingDelete],
    [NOVEL_EVIDENCE_OPERATION_TYPE.entityChangePut, applyEntityChangePut],
    [NOVEL_EVIDENCE_OPERATION_TYPE.entityChangeDelete, applyEntityChangeDelete],
    [NOVEL_EVIDENCE_OPERATION_TYPE.realizationPut, applyRealizationPut],
    [NOVEL_EVIDENCE_OPERATION_TYPE.realizationDelete, applyRealizationDelete],
  ];
  for (const [operationType, apply] of handlers) {
    registry.register({
      operationType,
      operationVersion: VERSION,
      apply: (context, operation) => apply(context.projectionEvidence, operation),
    });
  }
}

function applyCharacterBindingPut(store: NovelMutableProjectionEvidenceRepository, operation: NovelOperation): void {
  const value = captureStoryUnitCharacterBinding(captureValue(operation));
  const extra = [exists(STORY_UNIT, value.storyUnitId), exists(CHARACTER, value.characterId)];
  assertPutExpected(operation, CHARACTER_BINDING, value.characterId, extra);
  assertReferences(store, operation, value.storyUnitId, "character", value.characterId);
  assertPutState(store.getCharacterBinding(value.storyUnitId, value.characterId), store.getCharacterBindingDigest(value.storyUnitId, value.characterId), operation, CHARACTER_BINDING, value.characterId);
  store.putCharacterBinding(value);
}

function applyCharacterBindingDelete(store: NovelMutableProjectionEvidenceRepository, operation: NovelOperation): void {
  const { storyUnitId, entityId } = captureBindingIdentity(operation);
  const characterId = captureCharacterId(entityId);
  assertDeleteBindingExpected(operation, CHARACTER_BINDING, storyUnitId, characterId);
  assertDeleteState(store.getCharacterBinding(storyUnitId, characterId), store.getCharacterBindingDigest(storyUnitId, characterId), operation, CHARACTER_BINDING, characterId);
  if (!store.deleteCharacterBinding(storyUnitId, characterId)) throw invariant(operation, CHARACTER_BINDING, characterId);
}

function applyLocationBindingPut(store: NovelMutableProjectionEvidenceRepository, operation: NovelOperation): void {
  const value = captureStoryUnitLocationBinding(captureValue(operation));
  const extra = [exists(STORY_UNIT, value.storyUnitId), exists(LOCATION, value.locationId)];
  assertPutExpected(operation, LOCATION_BINDING, value.locationId, extra);
  assertReferences(store, operation, value.storyUnitId, "location", value.locationId);
  assertPutState(store.getLocationBinding(value.storyUnitId, value.locationId), store.getLocationBindingDigest(value.storyUnitId, value.locationId), operation, LOCATION_BINDING, value.locationId);
  store.putLocationBinding(value);
}

function applyLocationBindingDelete(store: NovelMutableProjectionEvidenceRepository, operation: NovelOperation): void {
  const { storyUnitId, entityId } = captureBindingIdentity(operation);
  const locationId = captureLocationId(entityId);
  assertDeleteBindingExpected(operation, LOCATION_BINDING, storyUnitId, locationId);
  assertDeleteState(store.getLocationBinding(storyUnitId, locationId), store.getLocationBindingDigest(storyUnitId, locationId), operation, LOCATION_BINDING, locationId);
  if (!store.deleteLocationBinding(storyUnitId, locationId)) throw invariant(operation, LOCATION_BINDING, locationId);
}

function applyEntityChangePut(store: NovelMutableProjectionEvidenceRepository, operation: NovelOperation): void {
  const value = captureStoryUnitEntityChange(captureValue(operation));
  const extra = [
    exists(STORY_UNIT, value.storyUnitId),
    exists(value.entityType, value.entityId),
    ...(value.relatedEntityId === undefined ? [] : [exists("story-entity", value.relatedEntityId)]),
  ];
  assertPutExpected(operation, ENTITY_CHANGE, value.id, extra);
  assertReferences(store, operation, value.storyUnitId, value.entityType, value.entityId);
  if (value.relatedEntityId !== undefined && !hasStoryEntity(store, value.relatedEntityId)) {
    throw missing(operation, "story-entity", value.relatedEntityId);
  }
  assertPutState(store.getEntityChange(value.id), store.getEntityChangeDigest(value.id), operation, ENTITY_CHANGE, value.id);
  store.putEntityChange(value);
}

function applyEntityChangeDelete(store: NovelMutableProjectionEvidenceRepository, operation: NovelOperation): void {
  const id = captureStoryUnitEntityChangeId(captureIdentity(operation));
  assertDeleteIdentityExpected(operation, ENTITY_CHANGE, id);
  assertDeleteState(store.getEntityChange(id), store.getEntityChangeDigest(id), operation, ENTITY_CHANGE, id);
  if (!store.deleteEntityChange(id)) throw invariant(operation, ENTITY_CHANGE, id);
}

function applyRealizationPut(store: NovelMutableProjectionEvidenceRepository, operation: NovelOperation): void {
  const value = captureStoryUnitRealization(captureValue(operation));
  const extra = [exists(STORY_UNIT, value.storyUnitId)];
  assertPutExpected(operation, REALIZATION, value.storyUnitId, extra);
  if (!store.hasStoryUnit(value.storyUnitId)) throw missing(operation, STORY_UNIT, value.storyUnitId);
  assertPutState(store.getRealization(value.storyUnitId), store.getRealizationDigest(value.storyUnitId), operation, REALIZATION, value.storyUnitId);
  store.putRealization(value);
}

function applyRealizationDelete(store: NovelMutableProjectionEvidenceRepository, operation: NovelOperation): void {
  const id = captureStoryUnitId(captureIdentity(operation));
  assertDeleteIdentityExpected(operation, REALIZATION, id);
  assertDeleteState(store.getRealization(id), store.getRealizationDigest(id), operation, REALIZATION, id);
  if (!store.deleteRealization(id)) throw invariant(operation, REALIZATION, id);
}

function putOperation(
  operationId: NovelOperationId,
  type: string,
  value: object,
  entityType: string,
  entityId: string,
  expectedRecordDigest: string | undefined,
  references: readonly NovelOperationPrecondition[],
) {
  return captureNovelOperation({
    operationId,
    operationVersion: VERSION,
    type,
    expected: [
      expectedRecordDigest === undefined ? absent(entityType, entityId) : exists(entityType, entityId),
      ...(expectedRecordDigest === undefined ? [] : [fieldDigest(entityType, entityId, expectedRecordDigest)]),
      ...references,
    ],
    payload: { value: toJsonObject(value) },
  });
}

function deleteBindingOperation(operationId: NovelOperationId, type: string, entityType: string, storyUnitId: StoryUnitId, entityId: string, digest: string) {
  return captureNovelOperation({
    operationId, operationVersion: VERSION, type,
    expected: [exists(entityType, entityId), fieldDigest(entityType, entityId, digest)],
    payload: { storyUnitId, entityId },
  });
}

function deleteIdentityOperation(operationId: NovelOperationId, type: string, entityType: string, id: string, digest: string) {
  return captureNovelOperation({
    operationId, operationVersion: VERSION, type,
    expected: [exists(entityType, id), fieldDigest(entityType, id, digest)],
    payload: { id },
  });
}

function assertReferences(store: NovelMutableProjectionEvidenceRepository, operation: NovelOperation, storyUnitId: StoryUnitId, entityType: "character" | "location", entityId: CharacterId | LocationId): void {
  if (!store.hasStoryUnit(storyUnitId)) throw missing(operation, STORY_UNIT, storyUnitId);
  const existsEntity = entityType === "character"
    ? store.hasCharacter(entityId as CharacterId)
    : store.hasLocation(entityId as LocationId);
  if (!existsEntity) throw missing(operation, entityType, entityId);
}

function hasStoryEntity(store: NovelMutableProjectionEvidenceRepository, id: string): boolean {
  return store.hasCharacter(id as CharacterId) || store.hasLocation(id as LocationId);
}

function assertPutExpected(operation: NovelOperation, entityType: string, entityId: string, references: readonly NovelOperationPrecondition[]): void {
  const first = operation.expected[0];
  const isReplace = first?.kind === "entity-exists";
  const expected = [
    isReplace ? exists(entityType, entityId) : absent(entityType, entityId),
    ...(isReplace ? [fieldDigest(entityType, entityId, expectedDigest(operation, 1))] : []),
    ...references,
  ];
  assertExpected(operation, expected);
}

function assertPutState(existing: unknown, actualDigest: string | undefined, operation: NovelOperation, entityType: string, entityId: string): void {
  const replacing = operation.expected[0]?.kind === "entity-exists";
  if (!replacing && existing !== undefined) throw new NovelOperationPreconditionError("entity_exists", entityType, entityId, operation.operationId);
  if (replacing) assertDigest(existing, actualDigest, operation, entityType, entityId);
}

function assertDeleteState(existing: unknown, actualDigest: string | undefined, operation: NovelOperation, entityType: string, entityId: string): void {
  assertDigest(existing, actualDigest, operation, entityType, entityId);
}

function assertDigest(existing: unknown, actualDigest: string | undefined, operation: NovelOperation, entityType: string, entityId: string): void {
  if (existing === undefined || actualDigest === undefined) throw missing(operation, entityType, entityId);
  const expected = operation.expected.find((value) => value.kind === "field-digest");
  if (expected?.kind !== "field-digest") throw invalidPrecondition();
  if (actualDigest !== expected.expectedDigest) {
    throw new NovelOperationPreconditionError("field_digest_mismatch", entityType, entityId, operation.operationId, "record");
  }
}

function assertDeleteBindingExpected(operation: NovelOperation, entityType: string, storyUnitId: StoryUnitId, entityId: string): void {
  const identity = captureBindingIdentity(operation);
  if (identity.storyUnitId !== storyUnitId || identity.entityId !== entityId) throw invalidPayload();
  assertExpected(operation, [exists(entityType, entityId), fieldDigest(entityType, entityId, expectedDigest(operation, 1))]);
}

function assertDeleteIdentityExpected(operation: NovelOperation, entityType: string, id: string): void {
  if (captureIdentity(operation) !== id) throw invalidPayload();
  assertExpected(operation, [exists(entityType, id), fieldDigest(entityType, id, expectedDigest(operation, 1))]);
}

function captureValue(operation: NovelOperation): unknown {
  const payload = capturePayloadObject(operation.payload, ["value"]);
  if (payload.value === null || typeof payload.value !== "object" || Array.isArray(payload.value)) throw invalidPayload();
  return payload.value;
}

function captureBindingIdentity(operation: NovelOperation): { storyUnitId: StoryUnitId; entityId: string } {
  const payload = capturePayloadObject(operation.payload, ["entityId", "storyUnitId"]);
  if (typeof payload.entityId !== "string") throw invalidPayload();
  return { storyUnitId: captureStoryUnitId(payload.storyUnitId), entityId: payload.entityId };
}

function captureIdentity(operation: NovelOperation): string {
  const payload = capturePayloadObject(operation.payload, ["id"]);
  if (typeof payload.id !== "string") throw invalidPayload();
  return payload.id;
}

function exists(entityType: string, entityId: string): NovelOperationPrecondition { return { kind: "entity-exists", entityType, entityId }; }
function absent(entityType: string, entityId: string): NovelOperationPrecondition { return { kind: "entity-absent", entityType, entityId }; }
function fieldDigest(entityType: string, entityId: string, expectedDigest: string): NovelOperationPrecondition {
  return { kind: "field-digest", entityType, entityId, fieldPath: "record", expectedDigest };
}
function expectedDigest(operation: NovelOperation, index: number): string {
  const value = operation.expected[index];
  if (value?.kind !== "field-digest") throw invalidPrecondition();
  return value.expectedDigest;
}
function assertExpected(operation: NovelOperation, expected: readonly NovelOperationPrecondition[]): void {
  if (operation.expected.length !== expected.length || operation.expected.some((value, index) =>
    canonicalStringifyJson(value as unknown as JsonObject) !== canonicalStringifyJson(expected[index] as unknown as JsonObject)
  )) throw invalidPrecondition();
}
function capturePayloadObject(payload: JsonObject, keys: readonly string[]): Record<string, unknown> {
  const actual = Object.keys(payload).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw invalidPayload();
  return payload;
}
function toJsonObject(value: object): JsonObject { return JSON.parse(canonicalStringifyJson(value as unknown as JsonObject)) as JsonObject; }
function missing(operation: NovelOperation, entityType: string, entityId: string) { return new NovelOperationPreconditionError("entity_missing", entityType, entityId, operation.operationId); }
function invariant(operation: NovelOperation, entityType: string, entityId: string) { return new NovelOperationPreconditionError("domain_invariant", entityType, entityId, operation.operationId); }
function invalidPayload() { return new NovelProtocolValidationError(NOVEL_PROTOCOL_FAILURE.invalidOperation, "operationPayload"); }
function invalidPrecondition() { return new NovelProtocolValidationError(NOVEL_PROTOCOL_FAILURE.invalidOperation, "operationPrecondition"); }
