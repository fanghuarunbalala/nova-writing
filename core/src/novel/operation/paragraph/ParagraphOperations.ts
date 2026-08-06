/** Versioned deterministic Paragraph structural Operations and synchronous handlers. */
import { type JsonObject } from "../../../event/index.js";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelOperationPreconditionError,
  type NovelOperationPreconditionFailure,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureParagraphId,
  captureStoryUnitId,
  type NovelOperationId,
  type ParagraphId,
  type StoryUnitId,
} from "../../identity/index.js";
import {
  captureOrderKey,
  captureParagraph,
  captureParagraphText,
  compareOrderKeys,
  type OrderKey,
  type Paragraph,
} from "../../model/index.js";
import type {
  NovelMutableParagraphRepository,
  NovelParagraphMutationContext,
  ParagraphDigestField,
} from "../../port/index.js";
import { captureNovelOperationVersion } from "../../version/index.js";
import {
  captureNovelOperation,
  type NovelOperation,
  type NovelOperationPrecondition,
} from "../NovelOperation.js";
import type { NovelOperationRegistry } from "../NovelOperationRegistry.js";

export const NOVEL_PARAGRAPH_OPERATION_TYPE = {
  create: "paragraph.create",
  textReplace: "paragraph.text.replace",
  orderReplace: "paragraph.order.replace",
  storyUnitReplace: "paragraph.story-unit.replace",
  delete: "paragraph.delete",
} as const;

const PARAGRAPH_OPERATION_VERSION = captureNovelOperationVersion(1);
const PARAGRAPH_ENTITY_TYPE = "paragraph";
const STORY_UNIT_ENTITY_TYPE = "story-unit";

interface ParagraphPayload extends JsonObject {
  readonly paragraph: JsonObject;
}

interface ParagraphIdentityPayload extends JsonObject {
  readonly paragraphId: string;
}

interface ParagraphTextReplacePayload extends JsonObject {
  readonly paragraphId: string;
  readonly text: string;
}

interface ParagraphOrderReplacePayload extends JsonObject {
  readonly paragraphId: string;
  readonly orderKey: string;
}

interface ParagraphStoryUnitReplacePayload extends JsonObject {
  readonly paragraphId: string;
  readonly storyUnitId: string;
}

export function createParagraphCreateOperation(input: {
  readonly operationId: NovelOperationId;
  readonly paragraph: Paragraph;
}): NovelOperation<
  typeof NOVEL_PARAGRAPH_OPERATION_TYPE.create,
  ParagraphPayload
> {
  const paragraph = captureParagraph(input.paragraph);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: PARAGRAPH_OPERATION_VERSION,
    type: NOVEL_PARAGRAPH_OPERATION_TYPE.create,
    expected: [
      absent(PARAGRAPH_ENTITY_TYPE, paragraph.id),
      exists(STORY_UNIT_ENTITY_TYPE, paragraph.storyUnitId),
    ],
    payload: { paragraph: toJsonObject(paragraph) },
  });
}

export function createParagraphTextReplaceOperation(input: {
  readonly operationId: NovelOperationId;
  readonly paragraphId: ParagraphId;
  readonly expectedTextDigest: string;
  readonly text: string;
}): NovelOperation<
  typeof NOVEL_PARAGRAPH_OPERATION_TYPE.textReplace,
  ParagraphTextReplacePayload
> {
  const paragraphId = captureParagraphId(input.paragraphId);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: PARAGRAPH_OPERATION_VERSION,
    type: NOVEL_PARAGRAPH_OPERATION_TYPE.textReplace,
    expected: [
      exists(PARAGRAPH_ENTITY_TYPE, paragraphId),
      fieldDigest(PARAGRAPH_ENTITY_TYPE, paragraphId, "text", input.expectedTextDigest),
    ],
    payload: { paragraphId, text: captureParagraphText(input.text) },
  });
}

export function createParagraphOrderReplaceOperation(input: {
  readonly operationId: NovelOperationId;
  readonly paragraphId: ParagraphId;
  readonly expectedOrderDigest: string;
  readonly orderKey: OrderKey;
}): NovelOperation<
  typeof NOVEL_PARAGRAPH_OPERATION_TYPE.orderReplace,
  ParagraphOrderReplacePayload
> {
  const paragraphId = captureParagraphId(input.paragraphId);
  const orderKey = captureOrderKey(input.orderKey);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: PARAGRAPH_OPERATION_VERSION,
    type: NOVEL_PARAGRAPH_OPERATION_TYPE.orderReplace,
    expected: [
      exists(PARAGRAPH_ENTITY_TYPE, paragraphId),
      fieldDigest(PARAGRAPH_ENTITY_TYPE, paragraphId, "orderKey", input.expectedOrderDigest),
    ],
    payload: { paragraphId, orderKey },
  });
}

export function createParagraphStoryUnitReplaceOperation(input: {
  readonly operationId: NovelOperationId;
  readonly paragraphId: ParagraphId;
  readonly expectedStoryUnitDigest: string;
  readonly storyUnitId: StoryUnitId;
}): NovelOperation<
  typeof NOVEL_PARAGRAPH_OPERATION_TYPE.storyUnitReplace,
  ParagraphStoryUnitReplacePayload
> {
  const paragraphId = captureParagraphId(input.paragraphId);
  const storyUnitId = captureStoryUnitId(input.storyUnitId);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: PARAGRAPH_OPERATION_VERSION,
    type: NOVEL_PARAGRAPH_OPERATION_TYPE.storyUnitReplace,
    expected: [
      exists(PARAGRAPH_ENTITY_TYPE, paragraphId),
      fieldDigest(
        PARAGRAPH_ENTITY_TYPE,
        paragraphId,
        "storyUnitId",
        input.expectedStoryUnitDigest,
      ),
      exists(STORY_UNIT_ENTITY_TYPE, storyUnitId),
    ],
    payload: { paragraphId, storyUnitId },
  });
}

export function createParagraphDeleteOperation(input: {
  readonly operationId: NovelOperationId;
  readonly paragraphId: ParagraphId;
  readonly expectedTextDigest: string;
  readonly expectedOrderDigest: string;
  readonly expectedStoryUnitDigest: string;
}): NovelOperation<
  typeof NOVEL_PARAGRAPH_OPERATION_TYPE.delete,
  ParagraphIdentityPayload
> {
  const paragraphId = captureParagraphId(input.paragraphId);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: PARAGRAPH_OPERATION_VERSION,
    type: NOVEL_PARAGRAPH_OPERATION_TYPE.delete,
    expected: [
      exists(PARAGRAPH_ENTITY_TYPE, paragraphId),
      fieldDigest(PARAGRAPH_ENTITY_TYPE, paragraphId, "text", input.expectedTextDigest),
      fieldDigest(PARAGRAPH_ENTITY_TYPE, paragraphId, "orderKey", input.expectedOrderDigest),
      fieldDigest(
        PARAGRAPH_ENTITY_TYPE,
        paragraphId,
        "storyUnitId",
        input.expectedStoryUnitDigest,
      ),
    ],
    payload: { paragraphId },
  });
}

export function registerNovelParagraphOperationHandlers<
  TContext extends NovelParagraphMutationContext,
>(registry: NovelOperationRegistry<TContext>): void {
  registry.register({
    operationType: NOVEL_PARAGRAPH_OPERATION_TYPE.create,
    operationVersion: PARAGRAPH_OPERATION_VERSION,
    apply: (context, operation) => applyParagraphCreate(context.paragraph, operation),
  });
  registry.register({
    operationType: NOVEL_PARAGRAPH_OPERATION_TYPE.textReplace,
    operationVersion: PARAGRAPH_OPERATION_VERSION,
    apply: (context, operation) => applyParagraphTextReplace(context.paragraph, operation),
  });
  registry.register({
    operationType: NOVEL_PARAGRAPH_OPERATION_TYPE.orderReplace,
    operationVersion: PARAGRAPH_OPERATION_VERSION,
    apply: (context, operation) => applyParagraphOrderReplace(context.paragraph, operation),
  });
  registry.register({
    operationType: NOVEL_PARAGRAPH_OPERATION_TYPE.storyUnitReplace,
    operationVersion: PARAGRAPH_OPERATION_VERSION,
    apply: (context, operation) => applyParagraphStoryUnitReplace(context.paragraph, operation),
  });
  registry.register({
    operationType: NOVEL_PARAGRAPH_OPERATION_TYPE.delete,
    operationVersion: PARAGRAPH_OPERATION_VERSION,
    apply: (context, operation) => applyParagraphDelete(context.paragraph, operation),
  });
}

function applyParagraphCreate(
  store: NovelMutableParagraphRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, ["paragraph"]);
  const paragraph = captureParagraph(payload.paragraph);
  assertExpected(operation, [
    absent(PARAGRAPH_ENTITY_TYPE, paragraph.id),
    exists(STORY_UNIT_ENTITY_TYPE, paragraph.storyUnitId),
  ]);
  if (!store.hasStoryUnit(paragraph.storyUnitId)) {
    throw precondition(
      operation,
      "entity_missing",
      STORY_UNIT_ENTITY_TYPE,
      paragraph.storyUnitId,
    );
  }
  if (store.getParagraph(paragraph.id) !== undefined) {
    throw precondition(operation, "entity_exists", PARAGRAPH_ENTITY_TYPE, paragraph.id);
  }
  if (
    store.findParagraphAt(paragraph.storyUnitId, paragraph.orderKey) !== undefined
  ) {
    throw precondition(
      operation,
      "domain_invariant",
      PARAGRAPH_ENTITY_TYPE,
      paragraph.id,
      "orderKey",
    );
  }
  if (!store.insertParagraph(paragraph)) {
    throw precondition(operation, "domain_invariant", PARAGRAPH_ENTITY_TYPE, paragraph.id);
  }
}

function applyParagraphTextReplace(
  store: NovelMutableParagraphRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, ["paragraphId", "text"]);
  const paragraphId = captureParagraphId(payload.paragraphId);
  const text = captureParagraphText(payload.text);
  assertExpected(operation, [
    exists(PARAGRAPH_ENTITY_TYPE, paragraphId),
    fieldDigest(PARAGRAPH_ENTITY_TYPE, paragraphId, "text", expectedDigest(operation, 1)),
  ]);
  assertParagraphDigest(store, operation, paragraphId, "text");
  const paragraph = requireParagraph(store, operation, paragraphId);
  if (!store.replaceParagraph(captureParagraph({ ...paragraph, text }))) {
    throw precondition(operation, "domain_invariant", PARAGRAPH_ENTITY_TYPE, paragraphId);
  }
}

function applyParagraphOrderReplace(
  store: NovelMutableParagraphRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, ["paragraphId", "orderKey"]);
  const paragraphId = captureParagraphId(payload.paragraphId);
  const orderKey = captureOrderKey(payload.orderKey);
  assertExpected(operation, [
    exists(PARAGRAPH_ENTITY_TYPE, paragraphId),
    fieldDigest(PARAGRAPH_ENTITY_TYPE, paragraphId, "orderKey", expectedDigest(operation, 1)),
  ]);
  assertParagraphDigest(store, operation, paragraphId, "orderKey");
  const paragraph = requireParagraph(store, operation, paragraphId);
  const occupant = store.findParagraphAt(paragraph.storyUnitId, orderKey);
  if (occupant !== undefined && occupant.id !== paragraph.id) {
    throw precondition(operation, "domain_invariant", PARAGRAPH_ENTITY_TYPE, paragraph.id);
  }
  if (!store.replaceParagraph(captureParagraph({ ...paragraph, orderKey }))) {
    throw precondition(operation, "domain_invariant", PARAGRAPH_ENTITY_TYPE, paragraph.id);
  }
}

function applyParagraphStoryUnitReplace(
  store: NovelMutableParagraphRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, ["paragraphId", "storyUnitId"]);
  const paragraphId = captureParagraphId(payload.paragraphId);
  const storyUnitId = captureStoryUnitId(payload.storyUnitId);
  assertExpected(operation, [
    exists(PARAGRAPH_ENTITY_TYPE, paragraphId),
    fieldDigest(
      PARAGRAPH_ENTITY_TYPE,
      paragraphId,
      "storyUnitId",
      expectedDigest(operation, 1),
    ),
    exists(STORY_UNIT_ENTITY_TYPE, storyUnitId),
  ]);
  assertParagraphDigest(store, operation, paragraphId, "storyUnitId");
  const paragraph = requireParagraph(store, operation, paragraphId);
  if (!store.hasStoryUnit(storyUnitId)) {
    throw precondition(
      operation,
      "entity_missing",
      STORY_UNIT_ENTITY_TYPE,
      storyUnitId,
    );
  }
  const occupant = store.findParagraphAt(storyUnitId, paragraph.orderKey);
  if (occupant !== undefined && occupant.id !== paragraph.id) {
    throw precondition(operation, "domain_invariant", PARAGRAPH_ENTITY_TYPE, paragraph.id);
  }
  if (!store.replaceParagraph(captureParagraph({ ...paragraph, storyUnitId }))) {
    throw precondition(operation, "domain_invariant", PARAGRAPH_ENTITY_TYPE, paragraph.id);
  }
}

function applyParagraphDelete(
  store: NovelMutableParagraphRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, ["paragraphId"]);
  const paragraphId = captureParagraphId(payload.paragraphId);
  assertExpected(operation, [
    exists(PARAGRAPH_ENTITY_TYPE, paragraphId),
    fieldDigest(PARAGRAPH_ENTITY_TYPE, paragraphId, "text", expectedDigest(operation, 1)),
    fieldDigest(PARAGRAPH_ENTITY_TYPE, paragraphId, "orderKey", expectedDigest(operation, 2)),
    fieldDigest(
      PARAGRAPH_ENTITY_TYPE,
      paragraphId,
      "storyUnitId",
      expectedDigest(operation, 3),
    ),
  ]);
  assertParagraphDigest(store, operation, paragraphId, "text");
  assertParagraphDigest(store, operation, paragraphId, "orderKey");
  assertParagraphDigest(store, operation, paragraphId, "storyUnitId");
  requireParagraph(store, operation, paragraphId);
  if (
    !store.removeParagraphFromChapters(paragraphId) ||
    !store.deleteParagraph(paragraphId)
  ) {
    throw precondition(operation, "domain_invariant", PARAGRAPH_ENTITY_TYPE, paragraphId);
  }
}

function requireParagraph(
  store: NovelMutableParagraphRepository,
  operation: NovelOperation,
  id: ParagraphId,
): Paragraph {
  const paragraph = store.getParagraph(id);
  if (paragraph === undefined) {
    throw precondition(operation, "entity_missing", PARAGRAPH_ENTITY_TYPE, id);
  }
  return paragraph;
}

function assertParagraphDigest(
  store: NovelMutableParagraphRepository,
  operation: NovelOperation,
  id: ParagraphId,
  field: ParagraphDigestField,
): void {
  const expected = operation.expected.find(
    (candidate) =>
      candidate.kind === "field-digest" &&
      candidate.entityType === PARAGRAPH_ENTITY_TYPE &&
      candidate.entityId === id &&
      candidate.fieldPath === field,
  );
  if (expected?.kind !== "field-digest") throw invalidPrecondition();
  const actual = store.getParagraphDigest(id, field);
  if (actual === undefined) {
    throw precondition(operation, "entity_missing", PARAGRAPH_ENTITY_TYPE, id);
  }
  if (actual !== expected.expectedDigest) {
    throw new NovelOperationPreconditionError(
      "field_digest_mismatch",
      PARAGRAPH_ENTITY_TYPE,
      id,
      operation.operationId,
      field,
    );
  }
}

function capturePayloadObject(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowedKeys.includes(key))
  ) {
    throw invalidPayload();
  }
  return value as Record<string, unknown>;
}

function toJsonObject(value: object): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
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

function absent(entityType: string, entityId: string): NovelOperationPrecondition {
  return Object.freeze({ kind: "entity-absent", entityType, entityId });
}

function exists(entityType: string, entityId: string): NovelOperationPrecondition {
  return Object.freeze({ kind: "entity-exists", entityType, entityId });
}

function fieldDigest(
  entityType: string,
  entityId: string,
  fieldPath: string,
  expectedDigest: string,
): NovelOperationPrecondition {
  return Object.freeze({
    kind: "field-digest",
    entityType,
    entityId,
    fieldPath,
    expectedDigest,
  });
}

function expectedDigest(operation: NovelOperation, index: number): string {
  const fieldDigests = operation.expected.filter(
    (candidate): candidate is NovelOperationPrecondition & {
      readonly kind: "field-digest";
    } => candidate.kind === "field-digest",
  );
  const value = fieldDigests[index - 1]?.expectedDigest;
  if (value === undefined) throw invalidPrecondition();
  return value;
}

function assertExpected(
  operation: NovelOperation,
  expected: readonly NovelOperationPrecondition[],
): void {
  if (
    operation.expected.length !== expected.length ||
    operation.expected.some((candidate, index) => !preconditionEqual(candidate, expected[index]))
  ) {
    throw invalidPrecondition();
  }
}

function preconditionEqual(
  left: NovelOperationPrecondition,
  right: NovelOperationPrecondition,
): boolean {
  return (
    left.kind === right.kind &&
    left.entityType === right.entityType &&
    left.entityId === right.entityId &&
    ("fieldPath" in left ? left.fieldPath : "") ===
      ("fieldPath" in right ? right.fieldPath : "") &&
    ("expectedDigest" in left ? left.expectedDigest : "") ===
      ("expectedDigest" in right ? right.expectedDigest : "")
  );
}

function precondition(
  operation: NovelOperation,
  reason: NovelOperationPreconditionFailure,
  entityType: string,
  entityId: string,
  field?: string,
): NovelOperationPreconditionError {
  return new NovelOperationPreconditionError(
    reason,
    entityType,
    entityId,
    operation.operationId,
    field,
  );
}
