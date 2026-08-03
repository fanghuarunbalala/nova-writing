/** Strict revision-bound, evidence-carrying Novel projection value contracts. */
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
import type {
  ManuscriptRangeRepairStatus,
} from "../validation/ManuscriptRangeRepairValidator.js";
import { MANUSCRIPT_RANGE_REPAIR_STATUS } from "../validation/ManuscriptRangeRepairValidator.js";
import {
  STORY_UNIT_CONFORMANCE_STATUS,
  type StoryUnitConformanceStatus,
} from "../model/manuscript/StoryUnitRealization.js";
import {
  captureNovelRevision,
  type NovelRevision,
} from "../version/index.js";

export const NOVEL_PROJECTION_MODE = {
  confirmed: "confirmed",
  planned: "planned",
} as const;

export type NovelProjectionMode =
  (typeof NOVEL_PROJECTION_MODE)[keyof typeof NOVEL_PROJECTION_MODE];

export const NOVEL_PROJECTION_FRESHNESS = {
  current: "current",
  stale: "stale",
} as const;

export type NovelProjectionFreshness =
  (typeof NOVEL_PROJECTION_FRESHNESS)[keyof typeof NOVEL_PROJECTION_FRESHNESS];

export interface CharacterCurrentStateProjection {
  readonly entityType: "character";
  readonly characterId: CharacterId;
  readonly atStoryUnitId: StoryUnitId;
  readonly mode: NovelProjectionMode;
  readonly sourceRevision: NovelRevision;
  readonly summary: string;
  readonly evidenceStoryUnitIds: readonly StoryUnitId[];
}

export interface LocationCurrentStateProjection {
  readonly entityType: "location";
  readonly locationId: LocationId;
  readonly atStoryUnitId: StoryUnitId;
  readonly mode: NovelProjectionMode;
  readonly sourceRevision: NovelRevision;
  readonly summary: string;
  readonly evidenceStoryUnitIds: readonly StoryUnitId[];
}

export type EntityProfileReadinessStatus = "sufficient" | "insufficient";

export interface EntityProfileReadinessProjection {
  readonly entityType: "character" | "location";
  readonly entityId: StoryEntityId;
  readonly forStoryUnitId: StoryUnitId;
  readonly sourceRevision: NovelRevision;
  readonly status: EntityProfileReadinessStatus;
  readonly missingInformation: readonly string[];
  readonly evidenceStoryUnitIds: readonly StoryUnitId[];
}

export interface CharacterRelationshipProjection {
  readonly focusCharacterId: CharacterId;
  readonly relatedCharacterId: CharacterId;
  readonly atStoryUnitId: StoryUnitId;
  readonly mode: NovelProjectionMode;
  readonly sourceRevision: NovelRevision;
  readonly summary: string;
  readonly evidenceStoryUnitIds: readonly StoryUnitId[];
}

export interface StoryUnitConformanceProjection {
  readonly storyUnitId: StoryUnitId;
  readonly sourceRevision: NovelRevision;
  readonly freshness: NovelProjectionFreshness;
  readonly validationStatus: StoryUnitConformanceStatus;
  readonly rangeStatuses: readonly ManuscriptRangeRepairStatus[];
  readonly warningCount: number;
  readonly errorCount: number;
  readonly evidenceStoryUnitIds: readonly StoryUnitId[];
}

const CHARACTER_STATE_KEYS = new Set([
  "entityType",
  "characterId",
  "atStoryUnitId",
  "mode",
  "sourceRevision",
  "summary",
  "evidenceStoryUnitIds",
]);
const LOCATION_STATE_KEYS = new Set([
  "entityType",
  "locationId",
  "atStoryUnitId",
  "mode",
  "sourceRevision",
  "summary",
  "evidenceStoryUnitIds",
]);
const READINESS_KEYS = new Set([
  "entityType",
  "entityId",
  "forStoryUnitId",
  "sourceRevision",
  "status",
  "missingInformation",
  "evidenceStoryUnitIds",
]);
const RELATIONSHIP_KEYS = new Set([
  "focusCharacterId",
  "relatedCharacterId",
  "atStoryUnitId",
  "mode",
  "sourceRevision",
  "summary",
  "evidenceStoryUnitIds",
]);
const CONFORMANCE_KEYS = new Set([
  "storyUnitId",
  "sourceRevision",
  "freshness",
  "validationStatus",
  "rangeStatuses",
  "warningCount",
  "errorCount",
  "evidenceStoryUnitIds",
]);

export function captureCharacterCurrentStateProjection(
  value: unknown,
): CharacterCurrentStateProjection {
  const candidate = captureRecord(value, CHARACTER_STATE_KEYS);
  if (candidate.entityType !== "character") throw invalidProjection();
  return Object.freeze({
    entityType: "character",
    characterId: captureCharacterId(candidate.characterId),
    atStoryUnitId: captureStoryUnitId(candidate.atStoryUnitId),
    mode: captureProjectionMode(candidate.mode),
    sourceRevision: captureNovelRevision(candidate.sourceRevision),
    summary: captureSummary(candidate.summary),
    evidenceStoryUnitIds: captureEvidence(candidate.evidenceStoryUnitIds),
  });
}

export function captureLocationCurrentStateProjection(
  value: unknown,
): LocationCurrentStateProjection {
  const candidate = captureRecord(value, LOCATION_STATE_KEYS);
  if (candidate.entityType !== "location") throw invalidProjection();
  return Object.freeze({
    entityType: "location",
    locationId: captureLocationId(candidate.locationId),
    atStoryUnitId: captureStoryUnitId(candidate.atStoryUnitId),
    mode: captureProjectionMode(candidate.mode),
    sourceRevision: captureNovelRevision(candidate.sourceRevision),
    summary: captureSummary(candidate.summary),
    evidenceStoryUnitIds: captureEvidence(candidate.evidenceStoryUnitIds),
  });
}

export function captureEntityProfileReadinessProjection(
  value: unknown,
): EntityProfileReadinessProjection {
  const candidate = captureRecord(value, READINESS_KEYS);
  captureDenseArray(candidate.missingInformation);
  const status = captureReadinessStatus(candidate.status);
  const missingInformation = Object.freeze(
    candidate.missingInformation.map(captureMissingInformation),
  );
  if (
    new Set(missingInformation).size !== missingInformation.length ||
    (status === "sufficient" && missingInformation.length > 0) ||
    (status === "insufficient" && missingInformation.length === 0)
  ) {
    throw invalidProjection();
  }
  const common = {
    forStoryUnitId: captureStoryUnitId(candidate.forStoryUnitId),
    sourceRevision: captureNovelRevision(candidate.sourceRevision),
    status,
    missingInformation,
    evidenceStoryUnitIds: captureEvidence(candidate.evidenceStoryUnitIds),
  };
  if (candidate.entityType === "character") {
    return Object.freeze({
      entityType: "character",
      entityId: captureCharacterId(candidate.entityId),
      ...common,
    });
  }
  if (candidate.entityType === "location") {
    return Object.freeze({
      entityType: "location",
      entityId: captureLocationId(candidate.entityId),
      ...common,
    });
  }
  throw invalidProjection();
}

export function captureCharacterRelationshipProjection(
  value: unknown,
): CharacterRelationshipProjection {
  const candidate = captureRecord(value, RELATIONSHIP_KEYS);
  const focusCharacterId = captureCharacterId(candidate.focusCharacterId);
  const relatedCharacterId = captureCharacterId(candidate.relatedCharacterId);
  if (focusCharacterId === relatedCharacterId) throw invalidProjection();
  return Object.freeze({
    focusCharacterId,
    relatedCharacterId,
    atStoryUnitId: captureStoryUnitId(candidate.atStoryUnitId),
    mode: captureProjectionMode(candidate.mode),
    sourceRevision: captureNovelRevision(candidate.sourceRevision),
    summary: captureSummary(candidate.summary),
    evidenceStoryUnitIds: captureEvidence(candidate.evidenceStoryUnitIds),
  });
}

export function captureStoryUnitConformanceProjection(
  value: unknown,
): StoryUnitConformanceProjection {
  const candidate = captureRecord(value, CONFORMANCE_KEYS);
  captureDenseArray(candidate.rangeStatuses);
  const rangeStatuses = Object.freeze(
    candidate.rangeStatuses.map(captureRangeStatus),
  );
  const storyUnitId = captureStoryUnitId(candidate.storyUnitId);
  const evidenceStoryUnitIds = captureEvidence(candidate.evidenceStoryUnitIds);
  if (!evidenceStoryUnitIds.includes(storyUnitId)) throw invalidProjection();
  return Object.freeze({
    storyUnitId,
    sourceRevision: captureNovelRevision(candidate.sourceRevision),
    freshness: captureFreshness(candidate.freshness),
    validationStatus: captureValidationStatus(candidate.validationStatus),
    rangeStatuses,
    warningCount: captureCount(candidate.warningCount),
    errorCount: captureCount(candidate.errorCount),
    evidenceStoryUnitIds,
  });
}

export function isNovelProjectionCurrent(
  projection: { readonly sourceRevision: NovelRevision },
  currentRevision: NovelRevision,
): boolean {
  return projection.sourceRevision === captureNovelRevision(currentRevision);
}

function captureRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length > 0 ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (descriptor) => !("value" in descriptor) || !descriptor.enumerable,
    ) ||
    Object.keys(value).some((key) => !allowedKeys.has(key))
  ) {
    throw invalidProjection();
  }
  return value as Record<string, unknown>;
}

function captureDenseArray(value: unknown): asserts value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.keys(value).length !== value.length
  ) {
    throw invalidProjection();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw invalidProjection();
    }
  }
}

function captureEvidence(value: unknown): readonly StoryUnitId[] {
  captureDenseArray(value);
  const evidence = value.map(captureStoryUnitId);
  if (new Set(evidence).size !== evidence.length) throw invalidProjection();
  return Object.freeze(evidence);
}

function captureProjectionMode(value: unknown): NovelProjectionMode {
  if (value !== "confirmed" && value !== "planned") throw invalidProjection();
  return value;
}

function captureFreshness(value: unknown): NovelProjectionFreshness {
  if (value !== "current" && value !== "stale") throw invalidProjection();
  return value;
}

function captureReadinessStatus(value: unknown): EntityProfileReadinessStatus {
  if (value !== "sufficient" && value !== "insufficient") {
    throw invalidProjection();
  }
  return value;
}

function captureValidationStatus(value: unknown): StoryUnitConformanceStatus {
  if (!Object.values(STORY_UNIT_CONFORMANCE_STATUS).includes(
    value as StoryUnitConformanceStatus,
  )) {
    throw invalidProjection();
  }
  return value as StoryUnitConformanceStatus;
}

function captureRangeStatus(value: unknown): ManuscriptRangeRepairStatus {
  if (!Object.values(MANUSCRIPT_RANGE_REPAIR_STATUS).includes(
    value as ManuscriptRangeRepairStatus,
  )) {
    throw invalidProjection();
  }
  return value as ManuscriptRangeRepairStatus;
}

function captureSummary(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 50_000 ||
    value.trim().length === 0 ||
    /\u0000/u.test(value)
  ) {
    throw invalidProjection();
  }
  return value;
}

function captureMissingInformation(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1_000 ||
    value.trim() !== value ||
    /\u0000/u.test(value)
  ) {
    throw invalidProjection();
  }
  return value;
}

function captureCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidProjection();
  }
  return value as number;
}

function invalidProjection(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidNovelProjection,
    "novelProjection",
  );
}
