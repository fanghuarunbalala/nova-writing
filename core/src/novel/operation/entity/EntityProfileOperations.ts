/** Deterministic Character and Location create, full-replace, and delete Operations. */
import type { JsonObject } from "../../../event/index.js";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelOperationPreconditionError,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureCharacterId,
  captureLocationId,
  type CharacterId,
  type LocationId,
  type NovelOperationId,
} from "../../identity/index.js";
import {
  captureCharacter,
  captureLocation,
  captureStableEntityProfile,
  type Character,
  type Location,
  type StableEntityProfile,
} from "../../model/index.js";
import type { NovelEntityMutationContext } from "../../port/index.js";
import {
  captureNovelEntityVersion,
  captureNovelOperationVersion,
  captureNovelTimestamp,
  type NovelEntityVersion,
  type NovelTimestamp,
} from "../../version/index.js";
import {
  captureNovelOperation,
  type NovelOperation,
} from "../NovelOperation.js";
import type { NovelOperationRegistry } from "../NovelOperationRegistry.js";

export const NOVEL_ENTITY_OPERATION_TYPE = {
  characterCreate: "character.create",
  characterReplace: "character.replace",
  characterDelete: "character.delete",
  locationCreate: "location.create",
  locationReplace: "location.replace",
  locationDelete: "location.delete",
} as const;

const ENTITY_OPERATION_VERSION = captureNovelOperationVersion(1);

interface EntityProfilePayload extends JsonObject {
  readonly id: string;
  readonly name: string;
  readonly aliases: string[];
  readonly timestamp: string;
  readonly summary: string | null;
  readonly initialState: string | null;
  readonly authorNotes: string | null;
  readonly expectedEntityVersion: number | null;
}

interface EntityDeletePayload extends JsonObject {
  readonly id: string;
  readonly expectedEntityVersion: number;
}

export type NovelEntityProfileOperationIntent =
  | {
      readonly action: "create" | "replace";
      readonly entityType: "character";
      readonly id: CharacterId;
      readonly profile: StableEntityProfile;
    }
  | {
      readonly action: "delete";
      readonly entityType: "character";
      readonly id: CharacterId;
    }
  | {
      readonly action: "create" | "replace";
      readonly entityType: "location";
      readonly id: LocationId;
      readonly profile: StableEntityProfile;
    }
  | {
      readonly action: "delete";
      readonly entityType: "location";
      readonly id: LocationId;
    };

export function createCharacterCreateOperation(input: {
  readonly operationId: NovelOperationId;
  readonly id: CharacterId;
  readonly profile: StableEntityProfile;
  readonly timestamp: NovelTimestamp;
}): NovelOperation<typeof NOVEL_ENTITY_OPERATION_TYPE.characterCreate, EntityProfilePayload> {
  return createProfileOperation(
    NOVEL_ENTITY_OPERATION_TYPE.characterCreate,
    "character",
    input.operationId,
    input.id,
    input.profile,
    input.timestamp,
  );
}

export function createCharacterReplaceOperation(input: {
  readonly operationId: NovelOperationId;
  readonly id: CharacterId;
  readonly expectedEntityVersion: NovelEntityVersion;
  readonly profile: StableEntityProfile;
  readonly timestamp: NovelTimestamp;
}): NovelOperation<typeof NOVEL_ENTITY_OPERATION_TYPE.characterReplace, EntityProfilePayload> {
  return createProfileOperation(
    NOVEL_ENTITY_OPERATION_TYPE.characterReplace,
    "character",
    input.operationId,
    input.id,
    input.profile,
    input.timestamp,
    input.expectedEntityVersion,
  );
}

export function createCharacterDeleteOperation(input: {
  readonly operationId: NovelOperationId;
  readonly id: CharacterId;
  readonly expectedEntityVersion: NovelEntityVersion;
}): NovelOperation<typeof NOVEL_ENTITY_OPERATION_TYPE.characterDelete, EntityDeletePayload> {
  return createDeleteOperation(
    NOVEL_ENTITY_OPERATION_TYPE.characterDelete,
    "character",
    input.operationId,
    input.id,
    input.expectedEntityVersion,
  );
}

export function createLocationCreateOperation(input: {
  readonly operationId: NovelOperationId;
  readonly id: LocationId;
  readonly profile: StableEntityProfile;
  readonly timestamp: NovelTimestamp;
}): NovelOperation<typeof NOVEL_ENTITY_OPERATION_TYPE.locationCreate, EntityProfilePayload> {
  return createProfileOperation(
    NOVEL_ENTITY_OPERATION_TYPE.locationCreate,
    "location",
    input.operationId,
    input.id,
    input.profile,
    input.timestamp,
  );
}

export function createLocationReplaceOperation(input: {
  readonly operationId: NovelOperationId;
  readonly id: LocationId;
  readonly expectedEntityVersion: NovelEntityVersion;
  readonly profile: StableEntityProfile;
  readonly timestamp: NovelTimestamp;
}): NovelOperation<typeof NOVEL_ENTITY_OPERATION_TYPE.locationReplace, EntityProfilePayload> {
  return createProfileOperation(
    NOVEL_ENTITY_OPERATION_TYPE.locationReplace,
    "location",
    input.operationId,
    input.id,
    input.profile,
    input.timestamp,
    input.expectedEntityVersion,
  );
}

export function createLocationDeleteOperation(input: {
  readonly operationId: NovelOperationId;
  readonly id: LocationId;
  readonly expectedEntityVersion: NovelEntityVersion;
}): NovelOperation<typeof NOVEL_ENTITY_OPERATION_TYPE.locationDelete, EntityDeletePayload> {
  return createDeleteOperation(
    NOVEL_ENTITY_OPERATION_TYPE.locationDelete,
    "location",
    input.operationId,
    input.id,
    input.expectedEntityVersion,
  );
}

export function captureNovelEntityProfileOperationIntent(
  operationInput: NovelOperation,
): NovelEntityProfileOperationIntent {
  const operation = captureNovelOperation(operationInput);
  switch (operation.type) {
    case NOVEL_ENTITY_OPERATION_TYPE.characterCreate:
    case NOVEL_ENTITY_OPERATION_TYPE.characterReplace: {
      const expected = operation.type === NOVEL_ENTITY_OPERATION_TYPE.characterCreate
        ? "absent"
        : "version";
      const payload = captureEntityProfilePayload(operation.payload, expected);
      const id = captureCharacterId(payload.id);
      captureEntityPrecondition(
        operation,
        "character",
        id,
        expected === "absent"
          ? undefined
          : captureNovelEntityVersion(payload.expectedEntityVersion),
      );
      return Object.freeze({
        action: expected === "absent" ? "create" : "replace",
        entityType: "character",
        id,
        profile: profileFromPayload(payload),
      });
    }
    case NOVEL_ENTITY_OPERATION_TYPE.characterDelete: {
      const payload = captureEntityDeletePayload(operation.payload);
      const id = captureCharacterId(payload.id);
      captureEntityPrecondition(
        operation,
        "character",
        id,
        captureNovelEntityVersion(payload.expectedEntityVersion),
      );
      return Object.freeze({ action: "delete", entityType: "character", id });
    }
    case NOVEL_ENTITY_OPERATION_TYPE.locationCreate:
    case NOVEL_ENTITY_OPERATION_TYPE.locationReplace: {
      const expected = operation.type === NOVEL_ENTITY_OPERATION_TYPE.locationCreate
        ? "absent"
        : "version";
      const payload = captureEntityProfilePayload(operation.payload, expected);
      const id = captureLocationId(payload.id);
      captureEntityPrecondition(
        operation,
        "location",
        id,
        expected === "absent"
          ? undefined
          : captureNovelEntityVersion(payload.expectedEntityVersion),
      );
      return Object.freeze({
        action: expected === "absent" ? "create" : "replace",
        entityType: "location",
        id,
        profile: profileFromPayload(payload),
      });
    }
    case NOVEL_ENTITY_OPERATION_TYPE.locationDelete: {
      const payload = captureEntityDeletePayload(operation.payload);
      const id = captureLocationId(payload.id);
      captureEntityPrecondition(
        operation,
        "location",
        id,
        captureNovelEntityVersion(payload.expectedEntityVersion),
      );
      return Object.freeze({ action: "delete", entityType: "location", id });
    }
    default:
      throw invalidOperationPayload();
  }
}

export function registerNovelEntityOperationHandlers(
  registry: NovelOperationRegistry<NovelEntityMutationContext>,
): void {
  registry.register({
    operationType: NOVEL_ENTITY_OPERATION_TYPE.characterCreate,
    operationVersion: ENTITY_OPERATION_VERSION,
    apply(context, operation) {
      applyCreate("character", context.characters, operation, captureCharacterId, captureCharacter);
    },
  });
  registry.register({
    operationType: NOVEL_ENTITY_OPERATION_TYPE.characterReplace,
    operationVersion: ENTITY_OPERATION_VERSION,
    apply(context, operation) {
      applyReplace("character", context.characters, operation, captureCharacterId, captureCharacter);
    },
  });
  registry.register({
    operationType: NOVEL_ENTITY_OPERATION_TYPE.characterDelete,
    operationVersion: ENTITY_OPERATION_VERSION,
    apply(context, operation) {
      applyDelete("character", context.characters, operation, captureCharacterId);
    },
  });
  registry.register({
    operationType: NOVEL_ENTITY_OPERATION_TYPE.locationCreate,
    operationVersion: ENTITY_OPERATION_VERSION,
    apply(context, operation) {
      applyCreate("location", context.locations, operation, captureLocationId, captureLocation);
    },
  });
  registry.register({
    operationType: NOVEL_ENTITY_OPERATION_TYPE.locationReplace,
    operationVersion: ENTITY_OPERATION_VERSION,
    apply(context, operation) {
      applyReplace("location", context.locations, operation, captureLocationId, captureLocation);
    },
  });
  registry.register({
    operationType: NOVEL_ENTITY_OPERATION_TYPE.locationDelete,
    operationVersion: ENTITY_OPERATION_VERSION,
    apply(context, operation) {
      applyDelete("location", context.locations, operation, captureLocationId);
    },
  });
}

function createProfileOperation<TType extends string, TId extends string>(
  type: TType,
  entityType: "character" | "location",
  operationId: NovelOperationId,
  id: TId,
  profile: StableEntityProfile,
  timestamp: NovelTimestamp,
  expectedEntityVersion?: NovelEntityVersion,
): NovelOperation<TType, EntityProfilePayload> {
  const capturedProfile = captureStableEntityProfile(profile);
  const capturedTimestamp = captureNovelTimestamp(timestamp);
  return captureNovelOperation({
    operationId,
    operationVersion: ENTITY_OPERATION_VERSION,
    type,
    expected: expectedEntityVersion === undefined
      ? [{ kind: "entity-absent", entityType, entityId: id }]
      : [{
          kind: "entity-version",
          entityType,
          entityId: id,
          expectedEntityVersion: captureNovelEntityVersion(expectedEntityVersion),
        }],
    payload: {
      id,
      name: capturedProfile.name,
      aliases: [...capturedProfile.aliases],
      timestamp: capturedTimestamp,
      summary: capturedProfile.summary ?? null,
      initialState: capturedProfile.initialState ?? null,
      authorNotes: capturedProfile.authorNotes ?? null,
      expectedEntityVersion: expectedEntityVersion ?? null,
    },
  });
}

function createDeleteOperation<TType extends string, TId extends string>(
  type: TType,
  entityType: "character" | "location",
  operationId: NovelOperationId,
  id: TId,
  expectedEntityVersion: NovelEntityVersion,
): NovelOperation<TType, EntityDeletePayload> {
  const version = captureNovelEntityVersion(expectedEntityVersion);
  return captureNovelOperation({
    operationId,
    operationVersion: ENTITY_OPERATION_VERSION,
    type,
    expected: [{
      kind: "entity-version",
      entityType,
      entityId: id,
      expectedEntityVersion: version,
    }],
    payload: { id, expectedEntityVersion: version },
  });
}

function applyCreate<TEntity, TId extends CharacterId | LocationId>(
  entityType: "character" | "location",
  repository: { insert(entity: TEntity): boolean },
  operation: NovelOperation,
  captureId: (value: unknown) => TId,
  captureEntity: (value: TEntity) => TEntity,
): void {
  const payload = captureEntityProfilePayload(operation.payload, "absent");
  const id = captureId(payload.id);
  captureEntityPrecondition(operation, entityType, id, undefined);
  const timestamp = captureNovelTimestamp(payload.timestamp);
  const entity = captureEntity({
    id,
    ...profileFromPayload(payload),
    entityVersion: captureNovelEntityVersion(1),
    createdAt: timestamp,
    updatedAt: timestamp,
  } as TEntity);
  if (!repository.insert(entity)) {
    throw new NovelOperationPreconditionError("entity_exists", entityType, id, operation.operationId);
  }
}

function applyReplace<TEntity extends Character | Location, TId extends CharacterId | LocationId>(
  entityType: "character" | "location",
  repository: {
    get(id: TId): TEntity | undefined;
    replace(entity: TEntity, expectedVersion: NovelEntityVersion): boolean;
  },
  operation: NovelOperation,
  captureId: (value: unknown) => TId,
  captureEntity: (value: TEntity) => TEntity,
): void {
  const payload = captureEntityProfilePayload(operation.payload, "version");
  const id = captureId(payload.id);
  const expectedVersion = captureNovelEntityVersion(
    payload.expectedEntityVersion,
  );
  captureEntityPrecondition(operation, entityType, id, expectedVersion);
  const existing = repository.get(id);
  if (existing === undefined) {
    throw new NovelOperationPreconditionError("entity_missing", entityType, id, operation.operationId);
  }
  const replacement = captureEntity({
    id,
    ...profileFromPayload(payload),
    entityVersion: captureNovelEntityVersion(expectedVersion + 1),
    createdAt: existing.createdAt,
    updatedAt: captureNovelTimestamp(payload.timestamp),
  } as TEntity);
  if (!repository.replace(replacement, expectedVersion)) {
    throw new NovelOperationPreconditionError("entity_version_mismatch", entityType, id, operation.operationId);
  }
}

function applyDelete<TId extends CharacterId | LocationId>(
  entityType: "character" | "location",
  repository: {
    get(id: TId): unknown;
    delete(id: TId, expectedVersion: NovelEntityVersion): boolean;
  },
  operation: NovelOperation,
  captureId: (value: unknown) => TId,
): void {
  const payload = captureEntityDeletePayload(operation.payload);
  const id = captureId(payload.id);
  const expectedVersion = captureNovelEntityVersion(payload.expectedEntityVersion);
  captureEntityPrecondition(operation, entityType, id, expectedVersion);
  if (repository.get(id) === undefined) {
    throw new NovelOperationPreconditionError("entity_missing", entityType, id, operation.operationId);
  }
  if (!repository.delete(id, expectedVersion)) {
    throw new NovelOperationPreconditionError("entity_version_mismatch", entityType, id, operation.operationId);
  }
}

function profileFromPayload(payload: EntityProfilePayload): StableEntityProfile {
  return captureStableEntityProfile({
    name: payload.name,
    aliases: payload.aliases,
    ...(payload.summary === null ? {} : { summary: payload.summary }),
    ...(payload.initialState === null
      ? {}
      : { initialState: payload.initialState }),
    ...(payload.authorNotes === null
      ? {}
      : { authorNotes: payload.authorNotes }),
  });
}

function captureEntityProfilePayload(
  payload: JsonObject,
  expected: "absent" | "version",
): EntityProfilePayload {
  const keys = [
    "aliases",
    "authorNotes",
    "expectedEntityVersion",
    "id",
    "initialState",
    "name",
    "summary",
    "timestamp",
  ];
  if (
    !hasExactKeys(payload, keys) ||
    typeof payload.id !== "string" ||
    typeof payload.name !== "string" ||
    !Array.isArray(payload.aliases) ||
    payload.aliases.some((alias) => typeof alias !== "string") ||
    typeof payload.timestamp !== "string" ||
    !isNullableString(payload.summary) ||
    !isNullableString(payload.initialState) ||
    !isNullableString(payload.authorNotes) ||
    (expected === "absent"
      ? payload.expectedEntityVersion !== null
      : typeof payload.expectedEntityVersion !== "number")
  ) {
    throw invalidOperationPayload();
  }
  return payload as EntityProfilePayload;
}

function captureEntityDeletePayload(payload: JsonObject): EntityDeletePayload {
  if (
    !hasExactKeys(payload, ["expectedEntityVersion", "id"]) ||
    typeof payload.id !== "string" ||
    typeof payload.expectedEntityVersion !== "number"
  ) {
    throw invalidOperationPayload();
  }
  return payload as EntityDeletePayload;
}

function captureEntityPrecondition(
  operation: NovelOperation,
  entityType: "character" | "location",
  entityId: CharacterId | LocationId,
  expectedEntityVersion: NovelEntityVersion | undefined,
): void {
  const precondition = operation.expected[0];
  const validBase = operation.expected.length === 1 &&
    precondition !== undefined &&
    precondition.entityType === entityType &&
    precondition.entityId === entityId;
  const validKind = expectedEntityVersion === undefined
    ? precondition?.kind === "entity-absent"
    : precondition?.kind === "entity-version" &&
      precondition.expectedEntityVersion === expectedEntityVersion;
  if (!validBase || !validKind) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidOperation,
      "operationPrecondition",
    );
  }
}

function hasExactKeys(value: JsonObject, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function invalidOperationPayload(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidOperation,
    "operationPayload",
  );
}
