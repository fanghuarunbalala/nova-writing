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
import type { StoryUnitProgressProjection } from "./StoryUnitProgress.js";
import {
  STORY_UNIT_REALIZATION_STATUS,
  type StoryUnitRealizationStatus,
} from "./StoryUnitStatus.js";

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

  getProgress(storyUnitId: StoryUnitId): StoryUnitProgressProjection | undefined {
    const unit = this.getUnit(storyUnitId);
    return unit === undefined ? undefined : this.projectProgress(unit);
  }

  private projectProgress(unit: StoryUnit): StoryUnitProgressProjection {
    const ancestorState = this.readAncestorState(unit);
    const effectivelyAbandoned =
      unit.realizationStatus === STORY_UNIT_REALIZATION_STATUS.abandoned ||
      ancestorState.isAbandoned;
    const isDirectlyBlocked = unit.blockState !== undefined;
    const isBlockedByAncestor = ancestorState.isBlocked;
    const activeLeaves = effectivelyAbandoned
      ? []
      : this.collectActiveLeaves(unit, isDirectlyBlocked || isBlockedByAncestor);
    const completedLeafCount = activeLeaves.filter(
      (leaf) => leaf.status === STORY_UNIT_REALIZATION_STATUS.completed,
    ).length;
    const blockedLeafCount = activeLeaves.filter((leaf) => leaf.isBlocked).length;
    return Object.freeze({
      storyUnitId: unit.id,
      effectiveStatus: effectivelyAbandoned
        ? STORY_UNIT_REALIZATION_STATUS.abandoned
        : deriveEffectiveStatus(activeLeaves, completedLeafCount),
      isBlocked: isDirectlyBlocked || isBlockedByAncestor,
      isDirectlyBlocked,
      isBlockedByAncestor,
      blockedLeafCount,
      completedLeafCount,
      totalLeafCount: activeLeaves.length,
    });
  }

  private readAncestorState(unit: StoryUnit): {
    isBlocked: boolean;
    isAbandoned: boolean;
  } {
    let isBlocked = false;
    let isAbandoned = false;
    let parent =
      unit.parentId === undefined ? undefined : this.unitsById.get(unit.parentId);
    while (parent !== undefined) {
      isBlocked ||= parent.blockState !== undefined;
      isAbandoned ||=
        parent.realizationStatus === STORY_UNIT_REALIZATION_STATUS.abandoned;
      parent =
        parent.parentId === undefined
          ? undefined
          : this.unitsById.get(parent.parentId);
    }
    return { isBlocked, isAbandoned };
  }

  private collectActiveLeaves(
    unit: StoryUnit,
    blockedBySelfOrAncestor: boolean,
  ): Array<{ status: StoryUnitRealizationStatus; isBlocked: boolean }> {
    const children = this.childrenByParentId.get(unit.id) ?? EMPTY_STORY_UNITS;
    if (children.length === 0) {
      return unit.realizationStatus === STORY_UNIT_REALIZATION_STATUS.abandoned
        ? []
        : [
            {
              status: unit.realizationStatus,
              isBlocked: blockedBySelfOrAncestor || unit.blockState !== undefined,
            },
          ];
    }
    const leaves: Array<{
      status: StoryUnitRealizationStatus;
      isBlocked: boolean;
    }> = [];
    for (const child of children) {
      if (child.realizationStatus === STORY_UNIT_REALIZATION_STATUS.abandoned) {
        continue;
      }
      leaves.push(
        ...this.collectActiveLeaves(
          child,
          blockedBySelfOrAncestor || child.blockState !== undefined,
        ),
      );
    }
    return leaves;
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
  assertStateReferences(units, unitsById);

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

function assertStateReferences(
  units: readonly StoryUnit[],
  unitsById: ReadonlyMap<StoryUnitId, StoryUnit>,
): void {
  for (const unit of units) {
    for (const dependencyId of unit.blockState?.dependencyIds ?? []) {
      if (dependencyId === unit.id || !unitsById.has(dependencyId)) {
        throw invalidStoryOutline();
      }
    }
    const replacementId = unit.abandonment?.replacementStoryUnitId;
    if (replacementId === undefined) continue;
    const replacement = unitsById.get(replacementId);
    if (
      replacement === undefined ||
      replacement.id === unit.id ||
      isDescendant(replacement, unit.id, unitsById) ||
      isEffectivelyAbandoned(replacement, unitsById)
    ) {
      throw invalidStoryOutline();
    }
  }
}

function isEffectivelyAbandoned(
  unit: StoryUnit,
  unitsById: ReadonlyMap<StoryUnitId, StoryUnit>,
): boolean {
  let current: StoryUnit | undefined = unit;
  while (current !== undefined) {
    if (current.realizationStatus === STORY_UNIT_REALIZATION_STATUS.abandoned) {
      return true;
    }
    current =
      current.parentId === undefined
        ? undefined
        : unitsById.get(current.parentId);
  }
  return false;
}

function isDescendant(
  candidate: StoryUnit,
  ancestorId: StoryUnitId,
  unitsById: ReadonlyMap<StoryUnitId, StoryUnit>,
): boolean {
  let current: StoryUnit | undefined = candidate;
  while (current.parentId !== undefined) {
    if (current.parentId === ancestorId) return true;
    current = unitsById.get(current.parentId);
    if (current === undefined) return false;
  }
  return false;
}

function deriveEffectiveStatus(
  activeLeaves: readonly { status: StoryUnitRealizationStatus }[],
  completedLeafCount: number,
): StoryUnitRealizationStatus {
  if (
    activeLeaves.length > 0 &&
    completedLeafCount === activeLeaves.length
  ) {
    return STORY_UNIT_REALIZATION_STATUS.completed;
  }
  if (
    completedLeafCount > 0 ||
    activeLeaves.some(
      (leaf) => leaf.status === STORY_UNIT_REALIZATION_STATUS.inProgress,
    )
  ) {
    return STORY_UNIT_REALIZATION_STATUS.inProgress;
  }
  return STORY_UNIT_REALIZATION_STATUS.pending;
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
