/** Defines durable projection targets and strictly matched disposable cache entries. */
import { canonicalStringifyJson } from "../../event/index.js";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../error/index.js";
import {
  captureCharacterId,
  captureLocationId,
  captureStoryUnitId,
  type CharacterId,
  type LocationId,
  type StoryEntityId,
  type StoryUnitId,
} from "../identity/index.js";
import {
  captureCharacterCurrentStateProjection,
  captureCharacterRelationshipProjection,
  captureEntityProfileReadinessProjection,
  captureLocationCurrentStateProjection,
  captureNovelProjectionMode,
  captureStoryUnitConformanceProjection,
  type CharacterCurrentStateProjection,
  type CharacterRelationshipProjection,
  type EntityProfileReadinessProjection,
  type LocationCurrentStateProjection,
  type NovelProjectionMode,
  type StoryUnitConformanceProjection,
} from "./NovelProjection.js";

export const NOVEL_PROJECTION_TARGET_KIND = {
  characterState: "character-state",
  locationState: "location-state",
  readiness: "readiness",
  characterRelationship: "character-relationship",
  storyUnitConformance: "story-unit-conformance",
} as const;

export type NovelProjectionTarget =
  | {
      readonly kind: "character-state";
      readonly characterId: CharacterId;
      readonly atStoryUnitId: StoryUnitId;
      readonly mode: NovelProjectionMode;
    }
  | {
      readonly kind: "location-state";
      readonly locationId: LocationId;
      readonly atStoryUnitId: StoryUnitId;
      readonly mode: NovelProjectionMode;
    }
  | {
      readonly kind: "readiness";
      readonly entityType: "character" | "location";
      readonly entityId: StoryEntityId;
      readonly forStoryUnitId: StoryUnitId;
    }
  | {
      readonly kind: "character-relationship";
      readonly focusCharacterId: CharacterId;
      readonly relatedCharacterId: CharacterId;
      readonly atStoryUnitId: StoryUnitId;
      readonly mode: NovelProjectionMode;
    }
  | {
      readonly kind: "story-unit-conformance";
      readonly storyUnitId: StoryUnitId;
    };

export type NovelProjectionValue =
  | CharacterCurrentStateProjection
  | LocationCurrentStateProjection
  | EntityProfileReadinessProjection
  | CharacterRelationshipProjection
  | StoryUnitConformanceProjection;

export interface NovelProjectionCacheEntry {
  readonly target: NovelProjectionTarget;
  readonly projection: NovelProjectionValue;
}

export function captureNovelProjectionTarget(
  value: unknown,
): NovelProjectionTarget {
  const candidate = captureRecord(value);
  switch (candidate.kind) {
    case NOVEL_PROJECTION_TARGET_KIND.characterState:
      assertKeys(candidate, ["kind", "characterId", "atStoryUnitId", "mode"]);
      return Object.freeze({
        kind: candidate.kind,
        characterId: captureCharacterId(candidate.characterId),
        atStoryUnitId: captureStoryUnitId(candidate.atStoryUnitId),
        mode: captureNovelProjectionMode(candidate.mode),
      });
    case NOVEL_PROJECTION_TARGET_KIND.locationState:
      assertKeys(candidate, ["kind", "locationId", "atStoryUnitId", "mode"]);
      return Object.freeze({
        kind: candidate.kind,
        locationId: captureLocationId(candidate.locationId),
        atStoryUnitId: captureStoryUnitId(candidate.atStoryUnitId),
        mode: captureNovelProjectionMode(candidate.mode),
      });
    case NOVEL_PROJECTION_TARGET_KIND.readiness: {
      assertKeys(candidate, ["kind", "entityType", "entityId", "forStoryUnitId"]);
      if (candidate.entityType !== "character" && candidate.entityType !== "location") {
        throw invalidProjectionCache();
      }
      return Object.freeze({
        kind: candidate.kind,
        entityType: candidate.entityType,
        entityId: candidate.entityType === "character"
          ? captureCharacterId(candidate.entityId)
          : captureLocationId(candidate.entityId),
        forStoryUnitId: captureStoryUnitId(candidate.forStoryUnitId),
      });
    }
    case NOVEL_PROJECTION_TARGET_KIND.characterRelationship: {
      assertKeys(candidate, [
        "kind",
        "focusCharacterId",
        "relatedCharacterId",
        "atStoryUnitId",
        "mode",
      ]);
      const focusCharacterId = captureCharacterId(candidate.focusCharacterId);
      const relatedCharacterId = captureCharacterId(candidate.relatedCharacterId);
      if (focusCharacterId === relatedCharacterId) throw invalidProjectionCache();
      return Object.freeze({
        kind: candidate.kind,
        focusCharacterId,
        relatedCharacterId,
        atStoryUnitId: captureStoryUnitId(candidate.atStoryUnitId),
        mode: captureNovelProjectionMode(candidate.mode),
      });
    }
    case NOVEL_PROJECTION_TARGET_KIND.storyUnitConformance:
      assertKeys(candidate, ["kind", "storyUnitId"]);
      return Object.freeze({
        kind: candidate.kind,
        storyUnitId: captureStoryUnitId(candidate.storyUnitId),
      });
    default:
      throw invalidProjectionCache();
  }
}

export function captureNovelProjectionCacheEntry(
  value: NovelProjectionCacheEntry,
): NovelProjectionCacheEntry {
  const target = captureNovelProjectionTarget(value.target);
  const projection = captureProjectionForTarget(target, value.projection);
  if (!matchesProjection(target, projection)) throw invalidProjectionCache();
  return Object.freeze({ target, projection });
}

export function canonicalizeNovelProjectionTarget(
  value: NovelProjectionTarget,
): string {
  return canonicalStringifyJson(
    captureNovelProjectionTarget(value) as unknown as Record<string, never>,
  );
}

function captureProjectionForTarget(
  target: NovelProjectionTarget,
  value: unknown,
): NovelProjectionValue {
  switch (target.kind) {
    case NOVEL_PROJECTION_TARGET_KIND.characterState:
      return captureCharacterCurrentStateProjection(value);
    case NOVEL_PROJECTION_TARGET_KIND.locationState:
      return captureLocationCurrentStateProjection(value);
    case NOVEL_PROJECTION_TARGET_KIND.readiness:
      return captureEntityProfileReadinessProjection(value);
    case NOVEL_PROJECTION_TARGET_KIND.characterRelationship:
      return captureCharacterRelationshipProjection(value);
    case NOVEL_PROJECTION_TARGET_KIND.storyUnitConformance:
      return captureStoryUnitConformanceProjection(value);
  }
}

function matchesProjection(
  target: NovelProjectionTarget,
  projection: NovelProjectionValue,
): boolean {
  switch (target.kind) {
    case NOVEL_PROJECTION_TARGET_KIND.characterState:
      return "characterId" in projection &&
        "mode" in projection &&
        projection.characterId === target.characterId &&
        projection.atStoryUnitId === target.atStoryUnitId &&
        projection.mode === target.mode;
    case NOVEL_PROJECTION_TARGET_KIND.locationState:
      return "locationId" in projection &&
        "mode" in projection &&
        projection.locationId === target.locationId &&
        projection.atStoryUnitId === target.atStoryUnitId &&
        projection.mode === target.mode;
    case NOVEL_PROJECTION_TARGET_KIND.readiness:
      return "forStoryUnitId" in projection &&
        projection.entityType === target.entityType &&
        projection.entityId === target.entityId &&
        projection.forStoryUnitId === target.forStoryUnitId;
    case NOVEL_PROJECTION_TARGET_KIND.characterRelationship:
      return "focusCharacterId" in projection &&
        projection.focusCharacterId === target.focusCharacterId &&
        projection.relatedCharacterId === target.relatedCharacterId &&
        projection.atStoryUnitId === target.atStoryUnitId &&
        projection.mode === target.mode;
    case NOVEL_PROJECTION_TARGET_KIND.storyUnitConformance:
      return "storyUnitId" in projection &&
        projection.storyUnitId === target.storyUnitId;
  }
}

function captureRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidProjectionCache();
  }
  return value as Record<string, unknown>;
}

function assertKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw invalidProjectionCache();
  }
}

function invalidProjectionCache(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidNovelProjection,
    "projectionCache",
  );
}
