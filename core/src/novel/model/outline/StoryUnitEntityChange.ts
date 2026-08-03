/** Captures persistent Character or Location consequences of one StoryUnit. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureCharacterId,
  captureLocationId,
  captureStoryEntityId,
  captureStoryEventStepId,
  captureStoryUnitEntityChangeId,
  captureStoryUnitId,
  type CharacterId,
  type LocationId,
  type StoryEntityId,
  type StoryEventStepId,
  type StoryUnitEntityChangeId,
  type StoryUnitId,
} from "../../identity/index.js";

export const STORY_ENTITY_CHANGE_CATEGORY = {
  identity: "identity",
  condition: "condition",
  location: "location",
  relationship: "relationship",
  knowledge: "knowledge",
  goal: "goal",
  ownership: "ownership",
  environment: "environment",
  custom: "custom",
} as const;
export type StoryEntityChangeCategory =
  (typeof STORY_ENTITY_CHANGE_CATEGORY)[keyof typeof STORY_ENTITY_CHANGE_CATEGORY];

interface StoryUnitEntityChangeBase {
  readonly id: StoryUnitEntityChangeId;
  readonly storyUnitId: StoryUnitId;
  readonly relatedEntityId?: StoryEntityId;
  readonly category: StoryEntityChangeCategory;
  readonly summary: string;
  readonly sourceEventIds: readonly StoryEventStepId[];
}

export interface CharacterStoryUnitEntityChange
  extends StoryUnitEntityChangeBase {
  readonly entityType: "character";
  readonly entityId: CharacterId;
}

export interface LocationStoryUnitEntityChange
  extends StoryUnitEntityChangeBase {
  readonly entityType: "location";
  readonly entityId: LocationId;
}

export type StoryUnitEntityChange =
  | CharacterStoryUnitEntityChange
  | LocationStoryUnitEntityChange;

const ENTITY_CHANGE_KEYS = new Set([
  "id",
  "storyUnitId",
  "entityType",
  "entityId",
  "relatedEntityId",
  "category",
  "summary",
  "sourceEventIds",
]);
const ENTITY_CHANGE_CATEGORIES = new Set<unknown>(
  Object.values(STORY_ENTITY_CHANGE_CATEGORY),
);

export function captureStoryUnitEntityChange(
  value: unknown,
): StoryUnitEntityChange {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !ENTITY_CHANGE_KEYS.has(key))
  ) {
    throw invalidStoryEntityChange();
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.sourceEventIds)) {
    throw invalidStoryEntityChange();
  }
  const sourceEventIds = candidate.sourceEventIds.map(captureStoryEventStepId);
  if (new Set(sourceEventIds).size !== sourceEventIds.length) {
    throw invalidStoryEntityChange();
  }
  const common = {
    id: captureStoryUnitEntityChangeId(candidate.id),
    storyUnitId: captureStoryUnitId(candidate.storyUnitId),
    ...captureRelatedEntity(candidate.relatedEntityId),
    category: captureCategory(candidate.category),
    summary: captureSummary(candidate.summary),
    sourceEventIds: Object.freeze(sourceEventIds),
  };
  if (candidate.entityType === "character") {
    return Object.freeze({
      ...common,
      entityType: "character",
      entityId: captureCharacterId(candidate.entityId),
    });
  }
  if (candidate.entityType === "location") {
    return Object.freeze({
      ...common,
      entityType: "location",
      entityId: captureLocationId(candidate.entityId),
    });
  }
  throw invalidStoryEntityChange();
}

export function captureStoryUnitEntityChanges(
  storyUnitIdInput: StoryUnitId,
  availableEventIdsInput: readonly StoryEventStepId[],
  value: unknown,
): readonly StoryUnitEntityChange[] {
  const storyUnitId = captureStoryUnitId(storyUnitIdInput);
  const availableEventIds = new Set(
    availableEventIdsInput.map(captureStoryEventStepId),
  );
  if (!Array.isArray(value)) throw invalidStoryEntityChange();
  const changes = value.map(captureStoryUnitEntityChange);
  const changeIds = new Set<StoryUnitEntityChangeId>();
  for (const change of changes) {
    if (
      change.storyUnitId !== storyUnitId ||
      changeIds.has(change.id) ||
      change.sourceEventIds.some((eventId) => !availableEventIds.has(eventId))
    ) {
      throw invalidStoryEntityChange();
    }
    changeIds.add(change.id);
  }
  return Object.freeze(
    changes.sort((left, right) => left.id.localeCompare(right.id)),
  );
}

function captureRelatedEntity(
  value: unknown,
): { relatedEntityId?: StoryEntityId } {
  return value === undefined
    ? {}
    : { relatedEntityId: captureStoryEntityId(value) };
}

function captureCategory(value: unknown): StoryEntityChangeCategory {
  if (!ENTITY_CHANGE_CATEGORIES.has(value)) throw invalidStoryEntityChange();
  return value as StoryEntityChangeCategory;
}

function captureSummary(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 20_000 ||
    value.trim() !== value ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)
  ) {
    throw invalidStoryEntityChange();
  }
  return value;
}

function invalidStoryEntityChange(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidStoryEntityChange,
    "storyEntityChange",
  );
}
