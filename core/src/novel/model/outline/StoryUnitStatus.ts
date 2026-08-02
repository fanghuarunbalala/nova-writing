/** Captures StoryUnit planning, realization, blocking, and abandonment state. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureStoryUnitId,
  type StoryUnitId,
} from "../../identity/index.js";
import {
  captureNovelTimestamp,
  type NovelTimestamp,
} from "../../version/index.js";

export const STORY_UNIT_PLANNING_STATUS = {
  idea: "idea",
  outlined: "outlined",
  ready: "ready",
} as const;
export type StoryUnitPlanningStatus =
  (typeof STORY_UNIT_PLANNING_STATUS)[keyof typeof STORY_UNIT_PLANNING_STATUS];

export const STORY_UNIT_REALIZATION_STATUS = {
  pending: "pending",
  inProgress: "in-progress",
  completed: "completed",
  abandoned: "abandoned",
} as const;
export type StoryUnitRealizationStatus =
  (typeof STORY_UNIT_REALIZATION_STATUS)[keyof typeof STORY_UNIT_REALIZATION_STATUS];

export const STORY_UNIT_BLOCK_REASON = {
  dependency: "dependency",
  decisionRequired: "decision-required",
  continuityConflict: "continuity-conflict",
  missingMaterial: "missing-material",
  outlineIncomplete: "outline-incomplete",
  other: "other",
} as const;
export type StoryUnitBlockReason =
  (typeof STORY_UNIT_BLOCK_REASON)[keyof typeof STORY_UNIT_BLOCK_REASON];

export const STORY_UNIT_ABANDON_REASON = {
  storyDirectionChanged: "story-direction-changed",
  replaced: "replaced",
  merged: "merged",
  duplicate: "duplicate",
  scopeReduced: "scope-reduced",
  other: "other",
} as const;
export type StoryUnitAbandonReason =
  (typeof STORY_UNIT_ABANDON_REASON)[keyof typeof STORY_UNIT_ABANDON_REASON];

export interface StoryUnitBlockState {
  readonly reasonCode?: StoryUnitBlockReason;
  readonly note?: string;
  readonly dependencyIds: readonly StoryUnitId[];
  readonly blockedAt: NovelTimestamp;
}

export interface StoryUnitAbandonment {
  readonly reasonCode?: StoryUnitAbandonReason;
  readonly note?: string;
  readonly replacementStoryUnitId?: StoryUnitId;
  readonly abandonedAt: NovelTimestamp;
}

const PLANNING_STATUSES = new Set<unknown>(
  Object.values(STORY_UNIT_PLANNING_STATUS),
);
const REALIZATION_STATUSES = new Set<unknown>(
  Object.values(STORY_UNIT_REALIZATION_STATUS),
);
const BLOCK_REASONS = new Set<unknown>(Object.values(STORY_UNIT_BLOCK_REASON));
const ABANDON_REASONS = new Set<unknown>(
  Object.values(STORY_UNIT_ABANDON_REASON),
);
const BLOCK_STATE_KEYS = new Set([
  "reasonCode",
  "note",
  "dependencyIds",
  "blockedAt",
]);
const ABANDONMENT_KEYS = new Set([
  "reasonCode",
  "note",
  "replacementStoryUnitId",
  "abandonedAt",
]);

export function captureStoryUnitPlanningStatus(
  value: unknown,
): StoryUnitPlanningStatus {
  if (!PLANNING_STATUSES.has(value)) throw invalidStoryUnit();
  return value as StoryUnitPlanningStatus;
}

export function captureStoryUnitRealizationStatus(
  value: unknown,
): StoryUnitRealizationStatus {
  if (!REALIZATION_STATUSES.has(value)) throw invalidStoryUnit();
  return value as StoryUnitRealizationStatus;
}

export function captureStoryUnitBlockState(
  value: unknown,
): StoryUnitBlockState {
  const candidate = captureObject(value, BLOCK_STATE_KEYS);
  if (!Array.isArray(candidate.dependencyIds)) throw invalidStoryUnit();
  const dependencyIds = candidate.dependencyIds.map(captureStoryUnitId);
  if (new Set(dependencyIds).size !== dependencyIds.length) {
    throw invalidStoryUnit();
  }
  const reasonCode = captureOptionalEnum(candidate.reasonCode, BLOCK_REASONS);
  const note = captureOptionalNote(candidate.note);
  return Object.freeze({
    ...(reasonCode === undefined ? {} : { reasonCode }),
    ...(note === undefined ? {} : { note }),
    dependencyIds: Object.freeze(dependencyIds),
    blockedAt: captureNovelTimestamp(candidate.blockedAt),
  }) as StoryUnitBlockState;
}

export function captureStoryUnitAbandonment(
  value: unknown,
): StoryUnitAbandonment {
  const candidate = captureObject(value, ABANDONMENT_KEYS);
  const reasonCode = captureOptionalEnum(candidate.reasonCode, ABANDON_REASONS);
  const note = captureOptionalNote(candidate.note);
  const replacementStoryUnitId =
    candidate.replacementStoryUnitId === undefined
      ? undefined
      : captureStoryUnitId(candidate.replacementStoryUnitId);
  return Object.freeze({
    ...(reasonCode === undefined ? {} : { reasonCode }),
    ...(note === undefined ? {} : { note }),
    ...(replacementStoryUnitId === undefined ? {} : { replacementStoryUnitId }),
    abandonedAt: captureNovelTimestamp(candidate.abandonedAt),
  }) as StoryUnitAbandonment;
}

function captureObject(
  value: unknown,
  keys: ReadonlySet<string>,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.has(key))
  ) {
    throw invalidStoryUnit();
  }
  return value as Record<string, unknown>;
}

function captureOptionalEnum<T>(
  value: unknown,
  allowed: ReadonlySet<unknown>,
): T | undefined {
  if (value === undefined) return undefined;
  if (!allowed.has(value)) throw invalidStoryUnit();
  return value as T;
}

function captureOptionalNote(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 20_000 ||
    value.trim().length === 0 ||
    /\u0000/u.test(value)
  ) {
    throw invalidStoryUnit();
  }
  return value;
}

function invalidStoryUnit(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidStoryUnit,
    "storyUnit",
  );
}
