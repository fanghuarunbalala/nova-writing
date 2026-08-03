import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  FractionalOrderKeyFactory,
  NovelOperationExecutor,
  NovelOperationPreconditionError,
  STORY_SETTING_MODE,
  captureCharacterId,
  captureLeafStoryUnitPlan,
  captureLocationId,
  captureNovelId,
  captureNovelOperationId,
  captureStoryOutline,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitId,
  canonicalStringifyJson,
  createDefaultNovelOperationRegistry,
  createLeafStoryUnitPlanClearOperation,
  createLeafStoryUnitPlanReplaceOperation,
  createStoryOutlineCreateOperation,
  createStoryUnitCreateOperation,
  createStoryUnitDeleteOperation,
  createStoryUnitMoveOperation,
  createStoryUnitReplaceOperation,
} from "../dist/index.js";

class MemoryEntityRepository {
  get() { return undefined; }
  insert() { return false; }
  replace() { return false; }
  delete() { return false; }
}

class MemoryOutlineRepository {
  outlines = new Map();
  units = new Map();
  plans = new Map();
  characters = new Set();
  locations = new Set();

  getOutline(id) { return this.outlines.get(id); }
  findOutlineByNovelId(novelId) {
    return [...this.outlines.values()].find((outline) => outline.novelId === novelId);
  }
  insertOutline(outline) {
    if (this.outlines.has(outline.id)) return false;
    this.outlines.set(outline.id, outline);
    return true;
  }
  getStoryUnit(id) { return this.units.get(id); }
  listStoryUnitChildren(parentId) {
    return [...this.units.values()].filter((unit) => unit.parentId === parentId);
  }
  findStoryUnitAt(outlineId, parentId, orderKey) {
    return [...this.units.values()].find(
      (unit) =>
        unit.outlineId === outlineId &&
        unit.parentId === parentId &&
        unit.orderKey === orderKey,
    );
  }
  isStoryUnitDescendant(ancestorId, candidateDescendantId) {
    let current = this.units.get(candidateDescendantId);
    while (current?.parentId !== undefined) {
      if (current.parentId === ancestorId) return true;
      current = this.units.get(current.parentId);
    }
    return false;
  }
  getStoryUnitDigest(id, field) {
    const unit = this.units.get(id);
    if (unit === undefined) return undefined;
    if (field === "parentId") return digest({ parentId: unit.parentId ?? null });
    if (field === "orderKey") return digest({ orderKey: unit.orderKey });
    const { id: ignoredId, outlineId: ignoredOutline, parentId, orderKey, ...content } = unit;
    void ignoredId;
    void ignoredOutline;
    void parentId;
    void orderKey;
    return digest(content);
  }
  insertStoryUnit(unit) {
    if (this.units.has(unit.id)) return false;
    this.units.set(unit.id, unit);
    return true;
  }
  replaceStoryUnit(unit) {
    if (!this.units.has(unit.id)) return false;
    this.units.set(unit.id, unit);
    return true;
  }
  deleteStoryUnit(id) { return this.units.delete(id); }
  getLeafStoryUnitPlan(id) { return this.plans.get(id); }
  getLeafStoryUnitPlanDigest(id) {
    const plan = this.plans.get(id);
    return plan === undefined ? undefined : digest(plan);
  }
  replaceLeafStoryUnitPlan(plan) {
    if (!this.units.has(plan.storyUnitId)) return false;
    this.plans.set(plan.storyUnitId, plan);
    return true;
  }
  clearLeafStoryUnitPlan(id) { return this.plans.delete(id); }
  hasCharacter(id) { return this.characters.has(id); }
  hasLocation(id) { return this.locations.has(id); }
  hasStoryEntity(id) { return this.characters.has(id) || this.locations.has(id); }
}

function digest(value) {
  return createHash("sha256").update(canonicalStringifyJson(value)).digest("hex");
}

let operationSequence = 0;
function operationId(label) {
  operationSequence += 1;
  return captureNovelOperationId(`${label}_${operationSequence}`);
}

const orderKeys = new FractionalOrderKeyFactory();
const outlineStore = new MemoryOutlineRepository();
const context = {
  characters: new MemoryEntityRepository(),
  locations: new MemoryEntityRepository(),
  outline: outlineStore,
};
const executor = new NovelOperationExecutor(createDefaultNovelOperationRegistry());
const outlineId = captureStoryOutlineId("outline_operations");
const outline = captureStoryOutline({
  id: outlineId,
  novelId: captureNovelId("novel_outline_operations"),
});
executor.executeSynchronous(context, createStoryOutlineCreateOperation({
  operationId: operationId("outline_create"),
  outline,
}));
assert.deepEqual(outlineStore.getOutline(outlineId), outline);

const rootId = captureStoryUnitId("story_unit_operations_root");
const childId = captureStoryUnitId("story_unit_operations_child");
const destinationId = captureStoryUnitId("story_unit_operations_destination");
const rootKey = orderKeys.initial();
const destinationKey = orderKeys.after(rootKey);
const childKey = orderKeys.initial();
for (const unit of [
  captureStoryUnit({
    id: rootId,
    outlineId,
    orderKey: rootKey,
    title: "Root",
    planningStatus: "outlined",
    realizationStatus: "pending",
  }),
  captureStoryUnit({
    id: destinationId,
    outlineId,
    orderKey: destinationKey,
    title: "Destination",
    planningStatus: "outlined",
    realizationStatus: "pending",
  }),
  captureStoryUnit({
    id: childId,
    outlineId,
    parentId: rootId,
    orderKey: childKey,
    title: "Child",
    intent: "This optional field must be cleared by replacement.",
    planningStatus: "idea",
    realizationStatus: "pending",
  }),
]) {
  executor.executeSynchronous(context, createStoryUnitCreateOperation({
    operationId: operationId("unit_create"),
    storyUnit: unit,
  }));
}

const childBeforeReplace = outlineStore.getStoryUnit(childId);
executor.executeSynchronous(context, createStoryUnitReplaceOperation({
  operationId: operationId("unit_replace"),
  storyUnitId: childId,
  expectedContentDigest: outlineStore.getStoryUnitDigest(childId, "content"),
  content: {
    title: "Child revised",
    synopsis: "A complete overwrite of narrative content.",
    planningStatus: "ready",
    realizationStatus: "in-progress",
  },
}));
const childAfterReplace = outlineStore.getStoryUnit(childId);
assert.equal(childAfterReplace.title, "Child revised");
assert.equal(childAfterReplace.intent, undefined);
assert.equal(childAfterReplace.parentId, childBeforeReplace.parentId);
assert.equal(childAfterReplace.orderKey, childBeforeReplace.orderKey);

assert.throws(
  () => executor.executeSynchronous(context, createStoryUnitReplaceOperation({
    operationId: operationId("unit_replace_stale"),
    storyUnitId: childId,
    expectedContentDigest: "stale_digest",
    content: {
      title: "Rejected",
      planningStatus: "ready",
      realizationStatus: "in-progress",
    },
  })),
  (error) =>
    error instanceof NovelOperationPreconditionError &&
    error.failure === "field_digest_mismatch" &&
    error.fieldPath === "content",
);

assert.throws(
  () => executor.executeSynchronous(context, createStoryUnitMoveOperation({
    operationId: operationId("unit_move_cycle"),
    storyUnitId: rootId,
    expectedParentDigest: outlineStore.getStoryUnitDigest(rootId, "parentId"),
    expectedOrderDigest: outlineStore.getStoryUnitDigest(rootId, "orderKey"),
    parentId: childId,
    orderKey: childKey,
  })),
  (error) =>
    error instanceof NovelOperationPreconditionError &&
    error.failure === "domain_invariant",
);

executor.executeSynchronous(context, createStoryUnitMoveOperation({
  operationId: operationId("unit_move"),
  storyUnitId: childId,
  expectedParentDigest: outlineStore.getStoryUnitDigest(childId, "parentId"),
  expectedOrderDigest: outlineStore.getStoryUnitDigest(childId, "orderKey"),
  orderKey: orderKeys.after(destinationKey),
}));
assert.equal(outlineStore.getStoryUnit(childId).parentId, undefined);

const protagonistId = captureCharacterId("character_operations_protagonist");
const locationId = captureLocationId("location_operations_harbor");
outlineStore.characters.add(protagonistId);
outlineStore.locations.add(locationId);
const plan = captureLeafStoryUnitPlan({
  storyUnitId: childId,
  settingMode: STORY_SETTING_MODE.locationIndependent,
  characters: [{ storyUnitId: childId, characterId: protagonistId }],
  locations: [{ storyUnitId: childId, locationId }],
  events: [],
  rhythmBeats: [],
  entityChanges: [],
});
  const planCreateOperation = createLeafStoryUnitPlanReplaceOperation({
    operationId: operationId("plan_create"),
    plan,
  });
  assert.deepEqual(
    planCreateOperation.expected.slice(2).map(({ entityType, entityId }) => [entityType, entityId]),
    [["character", protagonistId], ["location", locationId]],
  );
  executor.executeSynchronous(context, planCreateOperation);
assert.deepEqual(outlineStore.getLeafStoryUnitPlan(childId), plan);

executor.executeSynchronous(context, createLeafStoryUnitPlanReplaceOperation({
  operationId: operationId("plan_replace"),
  expectedPlanDigest: outlineStore.getLeafStoryUnitPlanDigest(childId),
  plan: captureLeafStoryUnitPlan({ ...plan, characters: [] }),
}));
assert.equal(outlineStore.getLeafStoryUnitPlan(childId).characters.length, 0);

assert.throws(
  () => executor.executeSynchronous(context, createStoryUnitCreateOperation({
    operationId: operationId("child_under_planned_leaf"),
    storyUnit: captureStoryUnit({
      id: captureStoryUnitId("story_unit_operations_forbidden_child"),
      outlineId,
      parentId: childId,
      orderKey: childKey,
      title: "Forbidden child",
      planningStatus: "idea",
      realizationStatus: "pending",
    }),
  })),
  (error) =>
    error instanceof NovelOperationPreconditionError &&
    error.failure === "domain_invariant",
);

executor.executeSynchronous(context, createLeafStoryUnitPlanClearOperation({
  operationId: operationId("plan_clear"),
  storyUnitId: childId,
  expectedPlanDigest: outlineStore.getLeafStoryUnitPlanDigest(childId),
}));
assert.equal(outlineStore.getLeafStoryUnitPlan(childId), undefined);

executor.executeSynchronous(context, createStoryUnitDeleteOperation({
  operationId: operationId("unit_delete"),
  storyUnitId: childId,
  expectedContentDigest: outlineStore.getStoryUnitDigest(childId, "content"),
  expectedParentDigest: outlineStore.getStoryUnitDigest(childId, "parentId"),
  expectedOrderDigest: outlineStore.getStoryUnitDigest(childId, "orderKey"),
}));
assert.equal(outlineStore.getStoryUnit(childId), undefined);

console.log("novel outline operation smoke passed");
