/** Validates and indexes one immutable ordered StoryUnit tree. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureStoryUnitId,
  type StoryUnitId,
} from "../../identity/index.js";
import { compareOrderKeys } from "./OrderKey.js";
import {
  captureStoryOutline,
  type StoryOutline,
} from "./StoryOutline.js";
import { captureStoryUnit, type StoryUnit } from "./StoryUnit.js";

export interface StoryOutlineTreeSnapshot {
  readonly outline: StoryOutline;
  readonly units: readonly StoryUnit[];
}

const STORY_OUTLINE_TREE_KEYS = new Set(["outline", "units"]);
const EMPTY_STORY_UNITS = Object.freeze([]) as readonly StoryUnit[];

export class StoryOutlineTree {
  private readonly snapshot: StoryOutlineTreeSnapshot;
  private readonly unitsById: ReadonlyMap<StoryUnitId, StoryUnit>;
  private readonly childrenByParentId: ReadonlyMap<
    StoryUnitId | undefined,
    readonly StoryUnit[]
  >;

  constructor(value: unknown) {
    const captured = captureTreeInput(value);
    const indexed = indexUnits(captured.outline, captured.units);
    const depthFirstUnits = listDepthFirst(indexed.childrenByParentId);
    this.snapshot = Object.freeze({
      outline: captured.outline,
      units: Object.freeze(depthFirstUnits),
    });
    this.unitsById = indexed.unitsById;
    this.childrenByParentId = indexed.childrenByParentId;
  }

  getSnapshot(): StoryOutlineTreeSnapshot {
    return this.snapshot;
  }

  getUnit(storyUnitId: StoryUnitId): StoryUnit | undefined {
    return this.unitsById.get(captureStoryUnitId(storyUnitId));
  }

  listRoots(): readonly StoryUnit[] {
    return this.childrenByParentId.get(undefined) ?? EMPTY_STORY_UNITS;
  }

  listChildren(parentId: StoryUnitId): readonly StoryUnit[] {
    return (
      this.childrenByParentId.get(captureStoryUnitId(parentId)) ??
      EMPTY_STORY_UNITS
    );
  }

  listDepthFirst(): readonly StoryUnit[] {
    return this.snapshot.units;
  }
}

function captureTreeInput(value: unknown): StoryOutlineTreeSnapshot {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !STORY_OUTLINE_TREE_KEYS.has(key))
  ) {
    throw invalidStoryOutline();
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.units)) throw invalidStoryOutline();
  return Object.freeze({
    outline: captureStoryOutline(candidate.outline),
    units: Object.freeze(candidate.units.map((unit) => captureStoryUnit(unit))),
  });
}

function indexUnits(
  outline: StoryOutline,
  units: readonly StoryUnit[],
): {
  unitsById: ReadonlyMap<StoryUnitId, StoryUnit>;
  childrenByParentId: ReadonlyMap<StoryUnitId | undefined, readonly StoryUnit[]>;
} {
  const unitsById = new Map<StoryUnitId, StoryUnit>();
  for (const unit of units) {
    if (unit.outlineId !== outline.id || unitsById.has(unit.id)) {
      throw invalidStoryOutline();
    }
    unitsById.set(unit.id, unit);
  }
  for (const unit of units) {
    if (
      unit.parentId === unit.id ||
      (unit.parentId !== undefined && !unitsById.has(unit.parentId))
    ) {
      throw invalidStoryOutline();
    }
  }
  assertAcyclic(units, unitsById);

  const mutableChildren = new Map<StoryUnitId | undefined, StoryUnit[]>();
  for (const unit of units) {
    const siblings = mutableChildren.get(unit.parentId) ?? [];
    if (siblings.some((sibling) => sibling.orderKey === unit.orderKey)) {
      throw invalidStoryOutline();
    }
    siblings.push(unit);
    mutableChildren.set(unit.parentId, siblings);
  }

  const childrenByParentId = new Map<
    StoryUnitId | undefined,
    readonly StoryUnit[]
  >();
  for (const [parentId, children] of mutableChildren) {
    childrenByParentId.set(
      parentId,
      Object.freeze(
        children.sort((left, right) =>
          compareOrderKeys(left.orderKey, right.orderKey),
        ),
      ),
    );
  }
  return {
    unitsById,
    childrenByParentId,
  };
}

function assertAcyclic(
  units: readonly StoryUnit[],
  unitsById: ReadonlyMap<StoryUnitId, StoryUnit>,
): void {
  const states = new Map<StoryUnitId, "visiting" | "visited">();
  const visit = (unit: StoryUnit): void => {
    const state = states.get(unit.id);
    if (state === "visited") return;
    if (state === "visiting") throw invalidStoryOutline();
    states.set(unit.id, "visiting");
    if (unit.parentId !== undefined) {
      const parent = unitsById.get(unit.parentId);
      if (parent === undefined) throw invalidStoryOutline();
      visit(parent);
    }
    states.set(unit.id, "visited");
  };
  for (const unit of units) {
    visit(unit);
  }
}

function listDepthFirst(
  childrenByParentId: ReadonlyMap<StoryUnitId | undefined, readonly StoryUnit[]>,
): StoryUnit[] {
  const result: StoryUnit[] = [];
  const stack = [...(childrenByParentId.get(undefined) ?? [])].reverse();
  while (stack.length > 0) {
    const unit = stack.pop();
    if (unit === undefined) break;
    result.push(unit);
    const children = childrenByParentId.get(unit.id) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) stack.push(child);
    }
  }
  return result;
}

function invalidStoryOutline(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidStoryOutline,
    "storyOutline",
  );
}
