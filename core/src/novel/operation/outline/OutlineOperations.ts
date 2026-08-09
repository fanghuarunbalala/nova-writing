/** Deterministic Story Outline and complete Leaf Plan Operations for Draft replay. */
import {
  canonicalStringifyJson,
  type JsonObject,
} from "../../../event/index.js";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelOperationPreconditionError,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureStoryUnitId,
  type NovelOperationId,
  type StoryUnitId,
} from "../../identity/index.js";
import {
  captureLeafStoryUnitPlan,
  captureOrderKey,
  captureStoryOutline,
  captureStoryUnit,
  captureStoryUnitContent,
  type LeafStoryUnitPlan,
  type OrderKey,
  type StoryOutline,
  type StoryUnit,
  type StoryUnitContent,
} from "../../model/index.js";
import type {
  NovelMutableOutlineRepository,
  NovelMutableParagraphRepository,
  NovelMutableProjectionEvidenceRepository,
  NovelOutlineMutationContext,
  NovelParagraphMutationContext,
  NovelProjectionEvidenceMutationContext,
  StoryUnitDigestField,
} from "../../port/index.js";
import {
  captureNovelEntityVersion,
  captureNovelOperationVersion,
  type NovelEntityVersion,
} from "../../version/index.js";
import {
  captureNovelOperation,
  type NovelOperation,
  type NovelOperationPrecondition,
} from "../NovelOperation.js";
import type { NovelOperationRegistry } from "../NovelOperationRegistry.js";

export const NOVEL_OUTLINE_OPERATION_TYPE = {
  storyOutlineCreate: "story-outline.create",
  storyUnitCreate: "story-unit.create",
  storyUnitReplace: "story-unit.replace",
  storyUnitMove: "story-unit.move",
  storyUnitDelete: "story-unit.delete",
  leafStoryUnitPlanReplace: "leaf-story-unit-plan.replace",
  leafStoryUnitPlanClear: "leaf-story-unit-plan.clear",
} as const;

const OUTLINE_OPERATION_VERSION = captureNovelOperationVersion(1);
const STORY_OUTLINE_ENTITY_TYPE = "story-outline";
const STORY_UNIT_ENTITY_TYPE = "story-unit";
const LEAF_PLAN_ENTITY_TYPE = "leaf-story-unit-plan";

interface StoryOutlinePayload extends JsonObject {
  readonly outline: JsonObject;
}

interface StoryUnitPayload extends JsonObject {
  readonly storyUnit: JsonObject;
}

interface StoryUnitReplacementPayload extends JsonObject {
  readonly id: string;
  readonly content: JsonObject;
  readonly expectedEntityVersion: number | null;
}

interface StoryUnitMovePayload extends JsonObject {
  readonly id: string;
  readonly parentId: string | null;
  readonly orderKey: string;
  readonly expectedEntityVersion: number | null;
}

interface StoryUnitDeletePayload extends JsonObject {
  readonly id: string;
  readonly expectedEntityVersion: number | null;
}

interface LeafPlanPayload extends JsonObject {
  readonly plan: JsonObject;
}

interface LeafPlanClearPayload extends JsonObject {
  readonly storyUnitId: string;
}

export function createStoryOutlineCreateOperation(input: {
  readonly operationId: NovelOperationId;
  readonly outline: StoryOutline;
}): NovelOperation<
  typeof NOVEL_OUTLINE_OPERATION_TYPE.storyOutlineCreate,
  StoryOutlinePayload
> {
  const outline = captureStoryOutline(input.outline);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: OUTLINE_OPERATION_VERSION,
    type: NOVEL_OUTLINE_OPERATION_TYPE.storyOutlineCreate,
    expected: [absent(STORY_OUTLINE_ENTITY_TYPE, outline.id)],
    payload: { outline: toJsonObject(outline) },
  });
}

export function createStoryUnitCreateOperation(input: {
  readonly operationId: NovelOperationId;
  readonly storyUnit: StoryUnit;
}): NovelOperation<
  typeof NOVEL_OUTLINE_OPERATION_TYPE.storyUnitCreate,
  StoryUnitPayload
> {
  const storyUnit = captureStoryUnit(input.storyUnit);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: OUTLINE_OPERATION_VERSION,
    type: NOVEL_OUTLINE_OPERATION_TYPE.storyUnitCreate,
    expected: [
      exists(STORY_OUTLINE_ENTITY_TYPE, storyUnit.outlineId),
      absent(STORY_UNIT_ENTITY_TYPE, storyUnit.id),
      ...(storyUnit.parentId === undefined
        ? []
        : [exists(STORY_UNIT_ENTITY_TYPE, storyUnit.parentId)]),
    ],
    payload: { storyUnit: toJsonObject(storyUnit) },
  });
}

export function createStoryUnitReplaceOperation(input: {
  readonly operationId: NovelOperationId;
  readonly storyUnitId: StoryUnitId;
  readonly expectedContentDigest: string;
  readonly content: StoryUnitContent;
  readonly expectedEntityVersion?: NovelEntityVersion;
}): NovelOperation<
  typeof NOVEL_OUTLINE_OPERATION_TYPE.storyUnitReplace,
  StoryUnitReplacementPayload
> {
  const storyUnitId = captureStoryUnitId(input.storyUnitId);
  const content = captureStoryUnitContent(input.content);
  const expectedEntityVersion =
    input.expectedEntityVersion === undefined
      ? undefined
      : captureNovelEntityVersion(input.expectedEntityVersion);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: OUTLINE_OPERATION_VERSION,
    type: NOVEL_OUTLINE_OPERATION_TYPE.storyUnitReplace,
    expected: [
      exists(STORY_UNIT_ENTITY_TYPE, storyUnitId),
      fieldDigest(
        STORY_UNIT_ENTITY_TYPE,
        storyUnitId,
        "content",
        input.expectedContentDigest,
      ),
      ...(expectedEntityVersion === undefined
        ? []
        : [version(STORY_UNIT_ENTITY_TYPE, storyUnitId, expectedEntityVersion)]),
    ],
    payload: {
      id: storyUnitId,
      content: toJsonObject(content),
      expectedEntityVersion: expectedEntityVersion ?? null,
    },
  });
}

export function createStoryUnitMoveOperation(input: {
  readonly operationId: NovelOperationId;
  readonly storyUnitId: StoryUnitId;
  readonly expectedParentDigest: string;
  readonly expectedOrderDigest: string;
  readonly parentId?: StoryUnitId;
  readonly orderKey: OrderKey;
  readonly expectedEntityVersion?: NovelEntityVersion;
}): NovelOperation<
  typeof NOVEL_OUTLINE_OPERATION_TYPE.storyUnitMove,
  StoryUnitMovePayload
> {
  const storyUnitId = captureStoryUnitId(input.storyUnitId);
  const parentId = input.parentId === undefined
    ? undefined
    : captureStoryUnitId(input.parentId);
  const orderKey = captureOrderKey(input.orderKey);
  const expectedEntityVersion =
    input.expectedEntityVersion === undefined
      ? undefined
      : captureNovelEntityVersion(input.expectedEntityVersion);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: OUTLINE_OPERATION_VERSION,
    type: NOVEL_OUTLINE_OPERATION_TYPE.storyUnitMove,
    expected: [
      exists(STORY_UNIT_ENTITY_TYPE, storyUnitId),
      fieldDigest(
        STORY_UNIT_ENTITY_TYPE,
        storyUnitId,
        "parentId",
        input.expectedParentDigest,
      ),
      fieldDigest(
        STORY_UNIT_ENTITY_TYPE,
        storyUnitId,
        "orderKey",
        input.expectedOrderDigest,
      ),
      ...(parentId === undefined
        ? []
        : [exists(STORY_UNIT_ENTITY_TYPE, parentId)]),
      ...(expectedEntityVersion === undefined
        ? []
        : [version(STORY_UNIT_ENTITY_TYPE, storyUnitId, expectedEntityVersion)]),
    ],
    payload: {
      id: storyUnitId,
      parentId: parentId ?? null,
      orderKey,
      expectedEntityVersion: expectedEntityVersion ?? null,
    },
  });
}

export function createStoryUnitDeleteOperation(input: {
  readonly operationId: NovelOperationId;
  readonly storyUnitId: StoryUnitId;
  readonly expectedContentDigest: string;
  readonly expectedParentDigest: string;
  readonly expectedOrderDigest: string;
  readonly expectedEntityVersion?: NovelEntityVersion;
}): NovelOperation<
  typeof NOVEL_OUTLINE_OPERATION_TYPE.storyUnitDelete,
  StoryUnitDeletePayload
> {
  const storyUnitId = captureStoryUnitId(input.storyUnitId);
  const expectedEntityVersion =
    input.expectedEntityVersion === undefined
      ? undefined
      : captureNovelEntityVersion(input.expectedEntityVersion);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: OUTLINE_OPERATION_VERSION,
    type: NOVEL_OUTLINE_OPERATION_TYPE.storyUnitDelete,
    expected: [
      exists(STORY_UNIT_ENTITY_TYPE, storyUnitId),
      fieldDigest(
        STORY_UNIT_ENTITY_TYPE,
        storyUnitId,
        "content",
        input.expectedContentDigest,
      ),
      fieldDigest(
        STORY_UNIT_ENTITY_TYPE,
        storyUnitId,
        "parentId",
        input.expectedParentDigest,
      ),
      fieldDigest(
        STORY_UNIT_ENTITY_TYPE,
        storyUnitId,
        "orderKey",
        input.expectedOrderDigest,
      ),
      ...(expectedEntityVersion === undefined
        ? []
        : [version(STORY_UNIT_ENTITY_TYPE, storyUnitId, expectedEntityVersion)]),
    ],
    payload: {
      id: storyUnitId,
      expectedEntityVersion: expectedEntityVersion ?? null,
    },
  });
}

export function createLeafStoryUnitPlanReplaceOperation(input: {
  readonly operationId: NovelOperationId;
  readonly plan: LeafStoryUnitPlan;
  readonly expectedPlanDigest?: string;
}): NovelOperation<
  typeof NOVEL_OUTLINE_OPERATION_TYPE.leafStoryUnitPlanReplace,
  LeafPlanPayload
> {
  const plan = captureLeafStoryUnitPlan(input.plan);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: OUTLINE_OPERATION_VERSION,
    type: NOVEL_OUTLINE_OPERATION_TYPE.leafStoryUnitPlanReplace,
    expected: [
      exists(STORY_UNIT_ENTITY_TYPE, plan.storyUnitId),
      input.expectedPlanDigest === undefined
        ? absent(LEAF_PLAN_ENTITY_TYPE, plan.storyUnitId)
        : fieldDigest(
            LEAF_PLAN_ENTITY_TYPE,
            plan.storyUnitId,
            "plan",
            input.expectedPlanDigest,
          ),
      ...planReferencePreconditions(plan),
    ],
    payload: { plan: toJsonObject(plan) },
  });
}

export function createLeafStoryUnitPlanClearOperation(input: {
  readonly operationId: NovelOperationId;
  readonly storyUnitId: StoryUnitId;
  readonly expectedPlanDigest: string;
}): NovelOperation<
  typeof NOVEL_OUTLINE_OPERATION_TYPE.leafStoryUnitPlanClear,
  LeafPlanClearPayload
> {
  const storyUnitId = captureStoryUnitId(input.storyUnitId);
  return captureNovelOperation({
    operationId: input.operationId,
    operationVersion: OUTLINE_OPERATION_VERSION,
    type: NOVEL_OUTLINE_OPERATION_TYPE.leafStoryUnitPlanClear,
    expected: [
      exists(STORY_UNIT_ENTITY_TYPE, storyUnitId),
      fieldDigest(
        LEAF_PLAN_ENTITY_TYPE,
        storyUnitId,
        "plan",
        input.expectedPlanDigest,
      ),
    ],
    payload: { storyUnitId },
  });
}

export function registerNovelOutlineOperationHandlers<
  TContext extends
    NovelOutlineMutationContext &
      NovelParagraphMutationContext &
      NovelProjectionEvidenceMutationContext,
>(registry: NovelOperationRegistry<TContext>): void {
  registry.register({
    operationType: NOVEL_OUTLINE_OPERATION_TYPE.storyOutlineCreate,
    operationVersion: OUTLINE_OPERATION_VERSION,
    apply(context, operation) {
      applyStoryOutlineCreate(context.outline, operation);
    },
  });
  registry.register({
    operationType: NOVEL_OUTLINE_OPERATION_TYPE.storyUnitCreate,
    operationVersion: OUTLINE_OPERATION_VERSION,
    apply(context, operation) {
      applyStoryUnitCreate(context.outline, operation);
    },
  });
  registry.register({
    operationType: NOVEL_OUTLINE_OPERATION_TYPE.storyUnitReplace,
    operationVersion: OUTLINE_OPERATION_VERSION,
    apply(context, operation) {
      applyStoryUnitReplace(context.outline, operation);
    },
  });
  registry.register({
    operationType: NOVEL_OUTLINE_OPERATION_TYPE.storyUnitMove,
    operationVersion: OUTLINE_OPERATION_VERSION,
    apply(context, operation) {
      applyStoryUnitMove(context.outline, operation);
    },
  });
  registry.register({
    operationType: NOVEL_OUTLINE_OPERATION_TYPE.storyUnitDelete,
    operationVersion: OUTLINE_OPERATION_VERSION,
    apply(context, operation) {
      applyStoryUnitDelete(
        context.outline,
        context.paragraph,
        context.projectionEvidence,
        operation,
      );
    },
  });
  registry.register({
    operationType: NOVEL_OUTLINE_OPERATION_TYPE.leafStoryUnitPlanReplace,
    operationVersion: OUTLINE_OPERATION_VERSION,
    apply(context, operation) {
      applyLeafPlanReplace(context.outline, operation);
    },
  });
  registry.register({
    operationType: NOVEL_OUTLINE_OPERATION_TYPE.leafStoryUnitPlanClear,
    operationVersion: OUTLINE_OPERATION_VERSION,
    apply(context, operation) {
      applyLeafPlanClear(context.outline, operation);
    },
  });
}

function applyStoryOutlineCreate(
  store: NovelMutableOutlineRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, ["outline"]);
  const outline = captureStoryOutline(payload.outline);
  assertExpected(operation, [absent(STORY_OUTLINE_ENTITY_TYPE, outline.id)]);
  if (store.getOutline(outline.id) !== undefined) {
    throw precondition(operation, "entity_exists", STORY_OUTLINE_ENTITY_TYPE, outline.id);
  }
  if (store.findOutlineByNovelId(outline.novelId) !== undefined) {
    throw precondition(operation, "domain_invariant", STORY_OUTLINE_ENTITY_TYPE, outline.id);
  }
  if (!store.insertOutline(outline)) {
    throw precondition(operation, "domain_invariant", STORY_OUTLINE_ENTITY_TYPE, outline.id);
  }
}

function applyStoryUnitCreate(
  store: NovelMutableOutlineRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, ["storyUnit"]);
  const unit = captureStoryUnit(payload.storyUnit);
  assertExpected(operation, [
    exists(STORY_OUTLINE_ENTITY_TYPE, unit.outlineId),
    absent(STORY_UNIT_ENTITY_TYPE, unit.id),
    ...(unit.parentId === undefined
      ? []
      : [exists(STORY_UNIT_ENTITY_TYPE, unit.parentId)]),
  ]);
  if (store.getOutline(unit.outlineId) === undefined) {
    throw precondition(operation, "entity_missing", STORY_OUTLINE_ENTITY_TYPE, unit.outlineId);
  }
  if (store.getStoryUnit(unit.id) !== undefined) {
    throw precondition(operation, "entity_exists", STORY_UNIT_ENTITY_TYPE, unit.id);
  }
  if (unit.parentId !== undefined) {
    const parent = store.getStoryUnit(unit.parentId);
    if (parent === undefined) {
      throw precondition(operation, "entity_missing", STORY_UNIT_ENTITY_TYPE, unit.parentId);
    }
    if (
      parent.outlineId !== unit.outlineId ||
      store.getLeafStoryUnitPlan(parent.id) !== undefined
    ) {
      throw precondition(operation, "domain_invariant", STORY_UNIT_ENTITY_TYPE, unit.id);
    }
  }
  assertPositionAvailable(store, unit, operation);
  if (!store.insertStoryUnit(unit)) {
    throw precondition(operation, "domain_invariant", STORY_UNIT_ENTITY_TYPE, unit.id);
  }
}

function applyStoryUnitReplace(
  store: NovelMutableOutlineRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, [
    "content",
    "id",
    "expectedEntityVersion",
  ]);
  const id = captureStoryUnitId(payload.id);
  const content = captureStoryUnitContent(payload.content);
  const expectedVersion = optionalEntityVersion(payload.expectedEntityVersion);
  assertUnitDigestExpected(operation, id, ["content"], undefined, expectedVersion);
  const existing = requireStoryUnit(store, operation, id);
  assertDigest(store, operation, id, "content");
  const replacement = captureStoryUnit({
    id: existing.id,
    outlineId: existing.outlineId,
    ...(existing.parentId === undefined ? {} : { parentId: existing.parentId }),
    orderKey: existing.orderKey,
    ...content,
  });
  if (!store.replaceStoryUnit(replacement, expectedVersion)) {
    if (expectedVersion !== undefined) {
      throw new NovelOperationPreconditionError(
        "entity_version_mismatch",
        STORY_UNIT_ENTITY_TYPE,
        id,
        operation.operationId,
      );
    }
    throw precondition(operation, "domain_invariant", STORY_UNIT_ENTITY_TYPE, id);
  }
}

function applyStoryUnitMove(
  store: NovelMutableOutlineRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, [
    "id",
    "orderKey",
    "parentId",
    "expectedEntityVersion",
  ]);
  const id = captureStoryUnitId(payload.id);
  const expectedVersion = optionalEntityVersion(payload.expectedEntityVersion);
  const parentId = payload.parentId === null
    ? undefined
    : captureStoryUnitId(payload.parentId);
  const orderKey = captureOrderKey(payload.orderKey);
  assertUnitDigestExpected(
    operation,
    id,
    ["parentId", "orderKey"],
    parentId,
    expectedVersion,
  );
  const existing = requireStoryUnit(store, operation, id);
  assertDigest(store, operation, id, "parentId");
  assertDigest(store, operation, id, "orderKey");
  if (parentId === id) {
    throw precondition(operation, "domain_invariant", STORY_UNIT_ENTITY_TYPE, id);
  }
  if (parentId !== undefined) {
    const parent = requireStoryUnit(store, operation, parentId);
    if (
      parent.outlineId !== existing.outlineId ||
      store.isStoryUnitDescendant(id, parentId) ||
      store.getLeafStoryUnitPlan(parentId) !== undefined
    ) {
      throw precondition(operation, "domain_invariant", STORY_UNIT_ENTITY_TYPE, id);
    }
  }
  const replacement = captureStoryUnit({ ...existing, parentId, orderKey });
  assertPositionAvailable(store, replacement, operation, id);
  if (!store.replaceStoryUnit(replacement, expectedVersion)) {
    if (expectedVersion !== undefined) {
      throw new NovelOperationPreconditionError(
        "entity_version_mismatch",
        STORY_UNIT_ENTITY_TYPE,
        id,
        operation.operationId,
      );
    }
    throw precondition(operation, "domain_invariant", STORY_UNIT_ENTITY_TYPE, id);
  }
}

function applyStoryUnitDelete(
  store: NovelMutableOutlineRepository,
  paragraphStore: NovelMutableParagraphRepository,
  evidence: NovelMutableProjectionEvidenceRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, [
    "id",
    "expectedEntityVersion",
  ]);
  const id = captureStoryUnitId(payload.id);
  const expectedVersion = optionalEntityVersion(payload.expectedEntityVersion);
  assertUnitDigestExpected(
    operation,
    id,
    ["content", "parentId", "orderKey"],
    undefined,
    expectedVersion,
  );
  requireStoryUnit(store, operation, id);
  assertDigest(store, operation, id, "content");
  assertDigest(store, operation, id, "parentId");
  assertDigest(store, operation, id, "orderKey");
  // 级联删除（删父带子）：子树 story unit（递归）→ leaf plan → 段落（先解绑章节）→
  // projection evidence 行。不再对子引用抛 entity_referenced；父级 digest/version
  // 前置条件不变，作为整棵子树删除的乐观锁门槛。
  // 证据表（novel_story_unit_character_bindings / _location_bindings / _entity_changes）
  // FK 指向 novel_story_units，必须先清理本单元及递归子单元的证据行，否则 deleteStoryUnit 会 FK 失败。
  cascadeDeleteStoryUnit(store, paragraphStore, evidence, id);
  if (!store.deleteStoryUnit(id, expectedVersion)) {
    if (expectedVersion !== undefined) {
      throw new NovelOperationPreconditionError(
        "entity_version_mismatch",
        STORY_UNIT_ENTITY_TYPE,
        id,
        operation.operationId,
      );
    }
    throw precondition(operation, "domain_invariant", STORY_UNIT_ENTITY_TYPE, id);
  }
}

/** 递归删除一棵 story unit 子树：子单元、leaf plan、段落（解绑章节后）、证据行。 */
function cascadeDeleteStoryUnit(
  store: NovelMutableOutlineRepository,
  paragraphStore: NovelMutableParagraphRepository,
  evidence: NovelMutableProjectionEvidenceRepository,
  id: StoryUnitId,
): void {
  for (const child of store.listStoryUnitChildren(id)) {
    // 递归先清整棵子树，再删本子单元：novel_story_units.parent_id FK 指向父行，
    // 必须先删后代再删父，否则 deleteStoryUnit 会 FK 失败。
    cascadeDeleteStoryUnit(store, paragraphStore, evidence, child.id);
    store.deleteStoryUnit(child.id);
  }
  if (store.getLeafStoryUnitPlan(id) !== undefined) {
    store.clearLeafStoryUnitPlan(id);
  }
  for (const paragraph of paragraphStore.listParagraphsByStoryUnit(id)) {
    paragraphStore.removeParagraphFromChapters(paragraph.id);
    paragraphStore.deleteParagraph(paragraph.id);
  }
  evidence.deleteCharacterBindingsByStoryUnit(id);
  evidence.deleteLocationBindingsByStoryUnit(id);
  evidence.deleteEntityChangesByStoryUnit(id);
}

function applyLeafPlanReplace(
  store: NovelMutableOutlineRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, ["plan"]);
  const plan = captureLeafStoryUnitPlan(payload.plan);
  const planPrecondition = operation.expected[1];
  const validPlanPrecondition =
    samePrecondition(planPrecondition, absent(LEAF_PLAN_ENTITY_TYPE, plan.storyUnitId)) ||
    (planPrecondition?.kind === "field-digest" &&
      planPrecondition.entityType === LEAF_PLAN_ENTITY_TYPE &&
      planPrecondition.entityId === plan.storyUnitId &&
      planPrecondition.fieldPath === "plan");
  if (!validPlanPrecondition) {
    throw invalidPrecondition();
  }
  assertExpected(operation, [
    exists(STORY_UNIT_ENTITY_TYPE, plan.storyUnitId),
    planPrecondition,
    ...planReferencePreconditions(plan),
  ]);
  requireStoryUnit(store, operation, plan.storyUnitId);
  if (store.listStoryUnitChildren(plan.storyUnitId).length > 0) {
    throw precondition(operation, "domain_invariant", LEAF_PLAN_ENTITY_TYPE, plan.storyUnitId);
  }
  const existing = store.getLeafStoryUnitPlan(plan.storyUnitId);
  if (planPrecondition?.kind === "entity-absent") {
    if (existing !== undefined) {
      throw precondition(operation, "entity_exists", LEAF_PLAN_ENTITY_TYPE, plan.storyUnitId);
    }
  } else {
    if (existing === undefined) {
      throw precondition(operation, "entity_missing", LEAF_PLAN_ENTITY_TYPE, plan.storyUnitId);
    }
    assertPlanDigest(store, operation, plan.storyUnitId);
  }
  assertPlanReferences(store, operation, plan);
  if (!store.replaceLeafStoryUnitPlan(plan)) {
    throw precondition(operation, "domain_invariant", LEAF_PLAN_ENTITY_TYPE, plan.storyUnitId);
  }
}

function applyLeafPlanClear(
  store: NovelMutableOutlineRepository,
  operation: NovelOperation,
): void {
  const payload = capturePayloadObject(operation.payload, ["storyUnitId"]);
  const id = captureStoryUnitId(payload.storyUnitId);
  assertExpected(operation, [
    exists(STORY_UNIT_ENTITY_TYPE, id),
    fieldDigest(LEAF_PLAN_ENTITY_TYPE, id, "plan", expectedDigest(operation, 1)),
  ]);
  requireStoryUnit(store, operation, id);
  if (store.getLeafStoryUnitPlan(id) === undefined) {
    throw precondition(operation, "entity_missing", LEAF_PLAN_ENTITY_TYPE, id);
  }
  assertPlanDigest(store, operation, id);
  if (!store.clearLeafStoryUnitPlan(id)) {
    throw precondition(operation, "domain_invariant", LEAF_PLAN_ENTITY_TYPE, id);
  }
}

function assertPlanReferences(
  store: NovelMutableOutlineRepository,
  operation: NovelOperation,
  plan: LeafStoryUnitPlan,
): void {
  for (const binding of plan.characters) {
    if (!store.hasCharacter(binding.characterId)) {
      throw precondition(operation, "entity_missing", "character", binding.characterId);
    }
  }
  for (const binding of plan.locations) {
    if (!store.hasLocation(binding.locationId)) {
      throw precondition(operation, "entity_missing", "location", binding.locationId);
    }
  }
  for (const change of plan.entityChanges) {
    const isKnown = change.entityType === "character"
      ? store.hasCharacter(change.entityId)
      : store.hasLocation(change.entityId);
    if (!isKnown) {
      throw precondition(operation, "entity_missing", change.entityType, change.entityId);
    }
    if (
      change.relatedEntityId !== undefined &&
      !store.hasStoryEntity(change.relatedEntityId)
    ) {
      throw precondition(operation, "entity_missing", "story-entity", change.relatedEntityId);
    }
  }
}

function planReferencePreconditions(
  plan: LeafStoryUnitPlan,
): readonly NovelOperationPrecondition[] {
  const references = new Map<string, NovelOperationPrecondition>();
  for (const binding of plan.characters) {
    addReference(references, "character", binding.characterId);
  }
  for (const binding of plan.locations) {
    addReference(references, "location", binding.locationId);
  }
  for (const change of plan.entityChanges) {
    addReference(references, change.entityType, change.entityId);
    if (change.relatedEntityId !== undefined) {
      addReference(references, "story-entity", change.relatedEntityId);
    }
  }
  return Object.freeze(
    [...references.values()].sort((left, right) =>
      `${left.entityType}:${left.entityId}`.localeCompare(
        `${right.entityType}:${right.entityId}`,
      )),
  );
}

function addReference(
  references: Map<string, NovelOperationPrecondition>,
  entityType: string,
  entityId: string,
): void {
  references.set(
    `${entityType}:${entityId}`,
    exists(entityType, entityId),
  );
}

function requireStoryUnit(
  store: NovelMutableOutlineRepository,
  operation: NovelOperation,
  id: StoryUnitId,
): StoryUnit {
  const unit = store.getStoryUnit(id);
  if (unit === undefined) {
    throw precondition(operation, "entity_missing", STORY_UNIT_ENTITY_TYPE, id);
  }
  return unit;
}

function assertPositionAvailable(
  store: NovelMutableOutlineRepository,
  unit: StoryUnit,
  operation: NovelOperation,
  ignoredId?: StoryUnitId,
): void {
  const occupant = store.findStoryUnitAt(
    unit.outlineId,
    unit.parentId,
    unit.orderKey,
  );
  if (occupant !== undefined && occupant.id !== ignoredId) {
    throw precondition(operation, "domain_invariant", STORY_UNIT_ENTITY_TYPE, unit.id);
  }
}

function assertUnitDigestExpected(
  operation: NovelOperation,
  id: StoryUnitId,
  fields: readonly StoryUnitDigestField[],
  destinationParentId?: StoryUnitId,
  expectedEntityVersion?: NovelEntityVersion,
): void {
  assertExpected(operation, [
    exists(STORY_UNIT_ENTITY_TYPE, id),
    ...fields.map((field, index) =>
      fieldDigest(
        STORY_UNIT_ENTITY_TYPE,
        id,
        field,
        expectedDigest(operation, index + 1),
      )),
    ...(destinationParentId === undefined
      ? []
      : [exists(STORY_UNIT_ENTITY_TYPE, destinationParentId)]),
    ...(expectedEntityVersion === undefined
      ? []
      : [version(STORY_UNIT_ENTITY_TYPE, id, expectedEntityVersion)]),
  ]);
}

function assertDigest(
  store: NovelMutableOutlineRepository,
  operation: NovelOperation,
  id: StoryUnitId,
  field: StoryUnitDigestField,
): void {
  const value = operation.expected.find(
    (candidate) =>
      candidate.kind === "field-digest" &&
      candidate.entityType === STORY_UNIT_ENTITY_TYPE &&
      candidate.entityId === id &&
      candidate.fieldPath === field,
  );
  if (value?.kind !== "field-digest") throw invalidPrecondition();
  const actual = store.getStoryUnitDigest(id, field);
  if (actual === undefined) {
    throw precondition(operation, "entity_missing", STORY_UNIT_ENTITY_TYPE, id);
  }
  if (actual !== value.expectedDigest) {
    throw precondition(
      operation,
      "field_digest_mismatch",
      STORY_UNIT_ENTITY_TYPE,
      id,
      field,
    );
  }
}

function assertPlanDigest(
  store: NovelMutableOutlineRepository,
  operation: NovelOperation,
  id: StoryUnitId,
): void {
  const value = operation.expected.find(
    (candidate) =>
      candidate.kind === "field-digest" &&
      candidate.entityType === LEAF_PLAN_ENTITY_TYPE &&
      candidate.entityId === id &&
      candidate.fieldPath === "plan",
  );
  if (value?.kind !== "field-digest") throw invalidPrecondition();
  const actual = store.getLeafStoryUnitPlanDigest(id);
  if (actual === undefined) {
    throw precondition(operation, "entity_missing", LEAF_PLAN_ENTITY_TYPE, id);
  }
  if (actual !== value.expectedDigest) {
    throw precondition(
      operation,
      "field_digest_mismatch",
      LEAF_PLAN_ENTITY_TYPE,
      id,
      "plan",
    );
  }
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

function version(
  entityType: string,
  entityId: string,
  expectedEntityVersion: NovelEntityVersion,
): NovelOperationPrecondition {
  return Object.freeze({
    kind: "entity-version",
    entityType,
    entityId,
    expectedEntityVersion,
  });
}

function optionalEntityVersion(
  value: unknown,
): NovelEntityVersion | undefined {
  return value === null || value === undefined
    ? undefined
    : captureNovelEntityVersion(value);
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
  return JSON.parse(
    canonicalStringifyJson(value as unknown as JsonObject),
  ) as JsonObject;
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
