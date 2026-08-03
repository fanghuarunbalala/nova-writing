/** Versioned deterministic Publication structure Operations and synchronous handlers. */
import { canonicalStringifyJson, type JsonObject } from "../../../event/index.js";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelOperationPreconditionError,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  capturePublicationChapterId,
  capturePublicationStructureId,
  capturePublicationVolumeId,
  type NovelOperationId,
  type PublicationChapterId,
  type PublicationVolumeId,
} from "../../identity/index.js";
import {
  capturePublicationChapter,
  capturePublicationStructure,
  capturePublicationVolume,
  type PublicationChapter,
  type PublicationStructure,
  type PublicationVolume,
} from "../../model/index.js";
import type {
  NovelMutablePublicationRepository,
  NovelPublicationMutationContext,
} from "../../port/index.js";
import { captureNovelOperationVersion } from "../../version/index.js";
import {
  captureNovelOperation,
  type NovelOperation,
  type NovelOperationPrecondition,
} from "../NovelOperation.js";
import type { NovelOperationRegistry } from "../NovelOperationRegistry.js";

export const NOVEL_PUBLICATION_OPERATION_TYPE = {
  publicationCreate: "publication.create",
  volumeCreate: "publication-volume.create",
  volumeReplace: "publication-volume.replace",
  volumeDelete: "publication-volume.delete",
  chapterCreate: "publication-chapter.create",
  chapterReplace: "publication-chapter.replace",
  chapterDelete: "publication-chapter.delete",
} as const;

const PUBLICATION_OPERATION_VERSION = captureNovelOperationVersion(1);
const PUBLICATION_ENTITY_TYPE = "publication";
const PUBLICATION_NOVEL_ENTITY_TYPE = "publication-for-novel";
const VOLUME_ENTITY_TYPE = "publication-volume";
const CHAPTER_ENTITY_TYPE = "publication-chapter";
const STORY_UNIT_ENTITY_TYPE = "story-unit";

interface PublicationPayload extends JsonObject {
  readonly publication: JsonObject;
}

interface VolumePayload extends JsonObject {
  readonly volume: JsonObject;
}

interface ChapterPayload extends JsonObject {
  readonly chapter: JsonObject;
}

interface IdentityPayload extends JsonObject {
  readonly id: string;
}

export function createPublicationCreateOperation(input: {
  readonly operationId: NovelOperationId;
  readonly publication: PublicationStructure;
}): NovelOperation<typeof NOVEL_PUBLICATION_OPERATION_TYPE.publicationCreate, PublicationPayload> {
  const publication = capturePublicationStructure(input.publication);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: PUBLICATION_OPERATION_VERSION,
    type: NOVEL_PUBLICATION_OPERATION_TYPE.publicationCreate,
    expected: [
      absent(PUBLICATION_ENTITY_TYPE, publication.id),
      absent(PUBLICATION_NOVEL_ENTITY_TYPE, publication.novelId),
    ],
    payload: { publication: toJsonObject(publication) },
  });
}

export function createPublicationVolumeCreateOperation(input: {
  readonly operationId: NovelOperationId;
  readonly volume: PublicationVolume;
}): NovelOperation<typeof NOVEL_PUBLICATION_OPERATION_TYPE.volumeCreate, VolumePayload> {
  const volume = capturePublicationVolume(input.volume);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: PUBLICATION_OPERATION_VERSION,
    type: NOVEL_PUBLICATION_OPERATION_TYPE.volumeCreate,
    expected: volumeExpected(volume, "create"),
    payload: { volume: toJsonObject(volume) },
  });
}

export function createPublicationVolumeReplaceOperation(input: {
  readonly operationId: NovelOperationId;
  readonly expectedRecordDigest: string;
  readonly volume: PublicationVolume;
}): NovelOperation<typeof NOVEL_PUBLICATION_OPERATION_TYPE.volumeReplace, VolumePayload> {
  const volume = capturePublicationVolume(input.volume);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: PUBLICATION_OPERATION_VERSION,
    type: NOVEL_PUBLICATION_OPERATION_TYPE.volumeReplace,
    expected: volumeExpected(volume, "replace", input.expectedRecordDigest),
    payload: { volume: toJsonObject(volume) },
  });
}

export function createPublicationVolumeDeleteOperation(input: {
  readonly operationId: NovelOperationId;
  readonly id: PublicationVolumeId;
  readonly expectedRecordDigest: string;
}): NovelOperation<typeof NOVEL_PUBLICATION_OPERATION_TYPE.volumeDelete, IdentityPayload> {
  const id = capturePublicationVolumeId(input.id);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: PUBLICATION_OPERATION_VERSION,
    type: NOVEL_PUBLICATION_OPERATION_TYPE.volumeDelete,
    expected: [
      exists(VOLUME_ENTITY_TYPE, id),
      fieldDigest(VOLUME_ENTITY_TYPE, id, "record", input.expectedRecordDigest),
    ],
    payload: { id },
  });
}

export function createPublicationChapterCreateOperation(input: {
  readonly operationId: NovelOperationId;
  readonly chapter: PublicationChapter;
}): NovelOperation<typeof NOVEL_PUBLICATION_OPERATION_TYPE.chapterCreate, ChapterPayload> {
  const chapter = capturePublicationChapter(input.chapter);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: PUBLICATION_OPERATION_VERSION,
    type: NOVEL_PUBLICATION_OPERATION_TYPE.chapterCreate,
    expected: chapterExpected(chapter, "create"),
    payload: { chapter: toJsonObject(chapter) },
  });
}

export function createPublicationChapterReplaceOperation(input: {
  readonly operationId: NovelOperationId;
  readonly expectedRecordDigest: string;
  readonly chapter: PublicationChapter;
}): NovelOperation<typeof NOVEL_PUBLICATION_OPERATION_TYPE.chapterReplace, ChapterPayload> {
  const chapter = capturePublicationChapter(input.chapter);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: PUBLICATION_OPERATION_VERSION,
    type: NOVEL_PUBLICATION_OPERATION_TYPE.chapterReplace,
    expected: chapterExpected(chapter, "replace", input.expectedRecordDigest),
    payload: { chapter: toJsonObject(chapter) },
  });
}

export function createPublicationChapterDeleteOperation(input: {
  readonly operationId: NovelOperationId;
  readonly id: PublicationChapterId;
  readonly expectedRecordDigest: string;
}): NovelOperation<typeof NOVEL_PUBLICATION_OPERATION_TYPE.chapterDelete, IdentityPayload> {
  const id = capturePublicationChapterId(input.id);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: PUBLICATION_OPERATION_VERSION,
    type: NOVEL_PUBLICATION_OPERATION_TYPE.chapterDelete,
    expected: [
      exists(CHAPTER_ENTITY_TYPE, id),
      fieldDigest(CHAPTER_ENTITY_TYPE, id, "record", input.expectedRecordDigest),
    ],
    payload: { id },
  });
}

export function registerNovelPublicationOperationHandlers<
  TContext extends NovelPublicationMutationContext,
>(registry: NovelOperationRegistry<TContext>): void {
  registry.register({
    operationType: NOVEL_PUBLICATION_OPERATION_TYPE.publicationCreate,
    operationVersion: PUBLICATION_OPERATION_VERSION,
    apply: (context, operation) => applyPublicationCreate(context.publication, operation),
  });
  registry.register({
    operationType: NOVEL_PUBLICATION_OPERATION_TYPE.volumeCreate,
    operationVersion: PUBLICATION_OPERATION_VERSION,
    apply: (context, operation) => applyVolumeCreate(context.publication, operation),
  });
  registry.register({
    operationType: NOVEL_PUBLICATION_OPERATION_TYPE.volumeReplace,
    operationVersion: PUBLICATION_OPERATION_VERSION,
    apply: (context, operation) => applyVolumeReplace(context.publication, operation),
  });
  registry.register({
    operationType: NOVEL_PUBLICATION_OPERATION_TYPE.volumeDelete,
    operationVersion: PUBLICATION_OPERATION_VERSION,
    apply: (context, operation) => applyVolumeDelete(context.publication, operation),
  });
  registry.register({
    operationType: NOVEL_PUBLICATION_OPERATION_TYPE.chapterCreate,
    operationVersion: PUBLICATION_OPERATION_VERSION,
    apply: (context, operation) => applyChapterCreate(context.publication, operation),
  });
  registry.register({
    operationType: NOVEL_PUBLICATION_OPERATION_TYPE.chapterReplace,
    operationVersion: PUBLICATION_OPERATION_VERSION,
    apply: (context, operation) => applyChapterReplace(context.publication, operation),
  });
  registry.register({
    operationType: NOVEL_PUBLICATION_OPERATION_TYPE.chapterDelete,
    operationVersion: PUBLICATION_OPERATION_VERSION,
    apply: (context, operation) => applyChapterDelete(context.publication, operation),
  });
}

function applyPublicationCreate(
  store: NovelMutablePublicationRepository,
  operation: NovelOperation,
): void {
  const publication = capturePublicationStructure(
    captureNestedPayload(operation.payload, "publication"),
  );
  assertExpected(operation, [
    absent(PUBLICATION_ENTITY_TYPE, publication.id),
    absent(PUBLICATION_NOVEL_ENTITY_TYPE, publication.novelId),
  ]);
  if (store.getPublication(publication.id) !== undefined) {
    throw precondition(operation, "entity_exists", PUBLICATION_ENTITY_TYPE, publication.id);
  }
  if (store.findPublicationByNovelId(publication.novelId) !== undefined) {
    throw precondition(
      operation,
      "entity_exists",
      PUBLICATION_NOVEL_ENTITY_TYPE,
      publication.novelId,
    );
  }
  if (!store.insertPublication(publication)) {
    throw precondition(operation, "domain_invariant", PUBLICATION_ENTITY_TYPE, publication.id);
  }
}

function applyVolumeCreate(
  store: NovelMutablePublicationRepository,
  operation: NovelOperation,
): void {
  const volume = capturePublicationVolume(captureNestedPayload(operation.payload, "volume"));
  assertExpected(operation, volumeExpected(volume, "create"));
  requirePublication(store, operation, volume.publicationId);
  if (store.getVolume(volume.id) !== undefined) {
    throw precondition(operation, "entity_exists", VOLUME_ENTITY_TYPE, volume.id);
  }
  assertVolumeReferences(store, operation, volume);
  assertVolumePosition(store, operation, volume);
  if (!store.insertVolume(volume)) {
    throw precondition(operation, "domain_invariant", VOLUME_ENTITY_TYPE, volume.id);
  }
}

function applyVolumeReplace(
  store: NovelMutablePublicationRepository,
  operation: NovelOperation,
): void {
  const volume = capturePublicationVolume(captureNestedPayload(operation.payload, "volume"));
  assertExpected(operation, volumeExpected(volume, "replace", expectedDigest(operation, 2)));
  requirePublication(store, operation, volume.publicationId);
  const existing = requireVolume(store, operation, volume.id);
  assertRecordDigest(store.getVolumeDigest(volume.id), operation, VOLUME_ENTITY_TYPE, volume.id);
  if (existing.publicationId !== volume.publicationId) {
    throw precondition(operation, "domain_invariant", VOLUME_ENTITY_TYPE, volume.id);
  }
  assertVolumeReferences(store, operation, volume);
  assertVolumePosition(store, operation, volume, volume.id);
  if (!store.replaceVolume(volume)) {
    throw precondition(operation, "domain_invariant", VOLUME_ENTITY_TYPE, volume.id);
  }
}

function applyVolumeDelete(
  store: NovelMutablePublicationRepository,
  operation: NovelOperation,
): void {
  const id = capturePublicationVolumeId(captureIdentityPayload(operation.payload));
  assertExpected(operation, [
    exists(VOLUME_ENTITY_TYPE, id),
    fieldDigest(VOLUME_ENTITY_TYPE, id, "record", expectedDigest(operation, 1)),
  ]);
  requireVolume(store, operation, id);
  assertRecordDigest(store.getVolumeDigest(id), operation, VOLUME_ENTITY_TYPE, id);
  if (store.listChapters(id).length > 0) {
    throw precondition(operation, "entity_referenced", VOLUME_ENTITY_TYPE, id);
  }
  if (!store.deleteVolume(id)) {
    throw precondition(operation, "domain_invariant", VOLUME_ENTITY_TYPE, id);
  }
}

function applyChapterCreate(
  store: NovelMutablePublicationRepository,
  operation: NovelOperation,
): void {
  const chapter = capturePublicationChapter(captureNestedPayload(operation.payload, "chapter"));
  assertExpected(operation, chapterExpected(chapter, "create"));
  requirePublication(store, operation, chapter.publicationId);
  requireOwningVolume(store, operation, chapter);
  if (store.getChapter(chapter.id) !== undefined) {
    throw precondition(operation, "entity_exists", CHAPTER_ENTITY_TYPE, chapter.id);
  }
  assertChapterPosition(store, operation, chapter);
  if (!store.insertChapter(chapter)) {
    throw precondition(operation, "domain_invariant", CHAPTER_ENTITY_TYPE, chapter.id);
  }
}

function applyChapterReplace(
  store: NovelMutablePublicationRepository,
  operation: NovelOperation,
): void {
  const chapter = capturePublicationChapter(captureNestedPayload(operation.payload, "chapter"));
  assertExpected(operation, chapterExpected(chapter, "replace", expectedDigest(operation, 3)));
  requirePublication(store, operation, chapter.publicationId);
  requireOwningVolume(store, operation, chapter);
  const existing = requireChapter(store, operation, chapter.id);
  assertRecordDigest(store.getChapterDigest(chapter.id), operation, CHAPTER_ENTITY_TYPE, chapter.id);
  if (existing.publicationId !== chapter.publicationId) {
    throw precondition(operation, "domain_invariant", CHAPTER_ENTITY_TYPE, chapter.id);
  }
  assertChapterPosition(store, operation, chapter, chapter.id);
  if (!store.replaceChapter(chapter)) {
    throw precondition(operation, "domain_invariant", CHAPTER_ENTITY_TYPE, chapter.id);
  }
}

function applyChapterDelete(
  store: NovelMutablePublicationRepository,
  operation: NovelOperation,
): void {
  const id = capturePublicationChapterId(captureIdentityPayload(operation.payload));
  assertExpected(operation, [
    exists(CHAPTER_ENTITY_TYPE, id),
    fieldDigest(CHAPTER_ENTITY_TYPE, id, "record", expectedDigest(operation, 1)),
  ]);
  requireChapter(store, operation, id);
  assertRecordDigest(store.getChapterDigest(id), operation, CHAPTER_ENTITY_TYPE, id);
  if (store.hasManuscriptBlocks(id)) {
    throw precondition(operation, "entity_referenced", CHAPTER_ENTITY_TYPE, id);
  }
  if (!store.deleteChapter(id)) {
    throw precondition(operation, "domain_invariant", CHAPTER_ENTITY_TYPE, id);
  }
}

function volumeExpected(
  volume: PublicationVolume,
  mode: "create" | "replace",
  expectedRecordDigest?: string,
): readonly NovelOperationPrecondition[] {
  return Object.freeze([
    exists(PUBLICATION_ENTITY_TYPE, volume.publicationId),
    mode === "create"
      ? absent(VOLUME_ENTITY_TYPE, volume.id)
      : exists(VOLUME_ENTITY_TYPE, volume.id),
    ...(mode === "replace"
      ? [fieldDigest(VOLUME_ENTITY_TYPE, volume.id, "record", expectedRecordDigest ?? "")]
      : []),
    ...(volume.primaryStoryUnitId === undefined
      ? []
      : [exists(STORY_UNIT_ENTITY_TYPE, volume.primaryStoryUnitId)]),
  ]);
}

function chapterExpected(
  chapter: PublicationChapter,
  mode: "create" | "replace",
  expectedRecordDigest?: string,
): readonly NovelOperationPrecondition[] {
  return Object.freeze([
    exists(PUBLICATION_ENTITY_TYPE, chapter.publicationId),
    exists(VOLUME_ENTITY_TYPE, chapter.volumeId),
    mode === "create"
      ? absent(CHAPTER_ENTITY_TYPE, chapter.id)
      : exists(CHAPTER_ENTITY_TYPE, chapter.id),
    ...(mode === "replace"
      ? [fieldDigest(CHAPTER_ENTITY_TYPE, chapter.id, "record", expectedRecordDigest ?? "")]
      : []),
  ]);
}

function requirePublication(
  store: NovelMutablePublicationRepository,
  operation: NovelOperation,
  id: PublicationStructure["id"],
): PublicationStructure {
  const publication = store.getPublication(id);
  if (publication === undefined) {
    throw precondition(operation, "entity_missing", PUBLICATION_ENTITY_TYPE, id);
  }
  return publication;
}

function requireVolume(
  store: NovelMutablePublicationRepository,
  operation: NovelOperation,
  id: PublicationVolumeId,
): PublicationVolume {
  const volume = store.getVolume(id);
  if (volume === undefined) {
    throw precondition(operation, "entity_missing", VOLUME_ENTITY_TYPE, id);
  }
  return volume;
}

function requireChapter(
  store: NovelMutablePublicationRepository,
  operation: NovelOperation,
  id: PublicationChapterId,
): PublicationChapter {
  const chapter = store.getChapter(id);
  if (chapter === undefined) {
    throw precondition(operation, "entity_missing", CHAPTER_ENTITY_TYPE, id);
  }
  return chapter;
}

function requireOwningVolume(
  store: NovelMutablePublicationRepository,
  operation: NovelOperation,
  chapter: PublicationChapter,
): PublicationVolume {
  const volume = requireVolume(store, operation, chapter.volumeId);
  if (volume.publicationId !== chapter.publicationId) {
    throw precondition(operation, "domain_invariant", CHAPTER_ENTITY_TYPE, chapter.id);
  }
  return volume;
}

function assertVolumeReferences(
  store: NovelMutablePublicationRepository,
  operation: NovelOperation,
  volume: PublicationVolume,
): void {
  if (
    volume.primaryStoryUnitId !== undefined &&
    !store.hasStoryUnit(volume.primaryStoryUnitId)
  ) {
    throw precondition(
      operation,
      "entity_missing",
      STORY_UNIT_ENTITY_TYPE,
      volume.primaryStoryUnitId,
    );
  }
}

function assertVolumePosition(
  store: NovelMutablePublicationRepository,
  operation: NovelOperation,
  volume: PublicationVolume,
  ignoredId?: PublicationVolumeId,
): void {
  const occupied = store.findVolumeAt(volume.publicationId, volume.orderKey);
  if (occupied !== undefined && occupied.id !== ignoredId) {
    throw precondition(operation, "domain_invariant", VOLUME_ENTITY_TYPE, volume.id, "orderKey");
  }
}

function assertChapterPosition(
  store: NovelMutablePublicationRepository,
  operation: NovelOperation,
  chapter: PublicationChapter,
  ignoredId?: PublicationChapterId,
): void {
  const occupied = store.findChapterAt(chapter.volumeId, chapter.orderKey);
  if (occupied !== undefined && occupied.id !== ignoredId) {
    throw precondition(operation, "domain_invariant", CHAPTER_ENTITY_TYPE, chapter.id, "orderKey");
  }
}

function assertRecordDigest(
  actual: string | undefined,
  operation: NovelOperation,
  entityType: string,
  entityId: string,
): void {
  const expected = operation.expected.find(
    (candidate) =>
      candidate.kind === "field-digest" &&
      candidate.entityType === entityType &&
      candidate.entityId === entityId &&
      candidate.fieldPath === "record",
  );
  if (expected?.kind !== "field-digest") throw invalidPrecondition();
  if (actual === undefined) {
    throw precondition(operation, "entity_missing", entityType, entityId);
  }
  if (actual !== expected.expectedDigest) {
    throw precondition(operation, "field_digest_mismatch", entityType, entityId, "record");
  }
}

function captureNestedPayload(payload: JsonObject, key: string): unknown {
  const record = capturePayloadObject(payload, [key]);
  const value = record[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidPayload();
  }
  return value;
}

function captureIdentityPayload(payload: JsonObject): string {
  const record = capturePayloadObject(payload, ["id"]);
  if (typeof record.id !== "string") throw invalidPayload();
  return record.id;
}

function assertExpected(
  operation: NovelOperation,
  expected: readonly NovelOperationPrecondition[],
): void {
  if (
    operation.expected.length !== expected.length ||
    operation.expected.some((value, index) => !samePrecondition(value, expected[index]))
  ) {
    throw invalidPrecondition();
  }
}

function samePrecondition(
  left: NovelOperationPrecondition | undefined,
  right: NovelOperationPrecondition | undefined,
): boolean {
  return left !== undefined && right !== undefined &&
    canonicalStringifyJson(left as unknown as JsonObject) ===
      canonicalStringifyJson(right as unknown as JsonObject);
}

function expectedDigest(operation: NovelOperation, index: number): string {
  const value = operation.expected[index];
  if (value?.kind !== "field-digest") throw invalidPrecondition();
  return value.expectedDigest;
}

function exists(entityType: string, entityId: string): NovelOperationPrecondition {
  return { kind: "entity-exists", entityType, entityId };
}

function absent(entityType: string, entityId: string): NovelOperationPrecondition {
  return { kind: "entity-absent", entityType, entityId };
}

function fieldDigest(
  entityType: string,
  entityId: string,
  fieldPath: string,
  expectedDigestValue: string,
): NovelOperationPrecondition {
  return {
    kind: "field-digest",
    entityType,
    entityId,
    fieldPath,
    expectedDigest: expectedDigestValue,
  };
}

function capturePayloadObject(
  payload: JsonObject,
  keys: readonly string[],
): Record<string, unknown> {
  const actual = Object.keys(payload).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw invalidPayload();
  }
  return payload;
}

function toJsonObject(value: object): JsonObject {
  return JSON.parse(canonicalStringifyJson(value as unknown as JsonObject)) as JsonObject;
}

function precondition(
  operation: NovelOperation,
  failure: ConstructorParameters<typeof NovelOperationPreconditionError>[0],
  entityType: string,
  entityId: string,
  fieldPath?: string,
): NovelOperationPreconditionError {
  return new NovelOperationPreconditionError(
    failure,
    entityType,
    entityId,
    operation.operationId,
    fieldPath,
  );
}

function invalidPayload(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidOperation,
    "operationPayload",
  );
}

function invalidPrecondition(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidOperation,
    "operationPrecondition",
  );
}
