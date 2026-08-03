/** Composes one progressive leaf writing plan and evaluates baseline readiness. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureCharacterId,
  captureLocationId,
  captureStoryUnitId,
  type CharacterId,
  type LocationId,
  type StoryEntityId,
  type StoryUnitId,
} from "../../identity/index.js";
import {
  captureOrderedRhythmBeats,
  type RhythmBeat,
} from "./RhythmBeat.js";
import {
  captureOrderedStoryEventSteps,
  type StoryEventStep,
} from "./StoryEventStep.js";
import { StoryOutlineTree } from "./StoryOutlineTree.js";
import {
  captureStoryTimeDescription,
  type StoryTimeDescription,
} from "./StoryTimeDescription.js";
import {
  captureStoryUnitCharacterBindings,
  captureStoryUnitLocationBindings,
  LOCATION_STORY_ROLE,
  type StoryUnitCharacterBinding,
  type StoryUnitLocationBinding,
} from "./StoryUnitBinding.js";
import {
  captureStoryUnitEntityChanges,
  type StoryUnitEntityChange,
} from "./StoryUnitEntityChange.js";

export const STORY_SETTING_MODE = {
  located: "located",
  locationIndependent: "location-independent",
} as const;
export type StorySettingMode =
  (typeof STORY_SETTING_MODE)[keyof typeof STORY_SETTING_MODE];

export interface LeafStoryUnitPlan {
  readonly storyUnitId: StoryUnitId;
  readonly settingMode: StorySettingMode;
  readonly time?: StoryTimeDescription;
  readonly characters: readonly StoryUnitCharacterBinding[];
  readonly locations: readonly StoryUnitLocationBinding[];
  readonly events: readonly StoryEventStep[];
  readonly rhythmBeats: readonly RhythmBeat[];
  readonly entityChanges: readonly StoryUnitEntityChange[];
}

export const LEAF_STORY_UNIT_READINESS_STATUS = {
  ready: "ready",
  notReady: "not-ready",
} as const;
export type LeafStoryUnitReadinessStatus =
  (typeof LEAF_STORY_UNIT_READINESS_STATUS)[keyof typeof LEAF_STORY_UNIT_READINESS_STATUS];

export const LEAF_STORY_UNIT_READINESS_FINDING = {
  storyUnitMissing: "story_unit_missing",
  storyUnitNotLeaf: "story_unit_not_leaf",
  storyTimeMissing: "story_time_missing",
  storyEventMissing: "story_event_missing",
  locatedPrimaryLocationRequired: "located_primary_location_required",
  locationIndependentPrimaryLocationForbidden:
    "location_independent_primary_location_forbidden",
  unknownCharacterReference: "unknown_character_reference",
  unknownLocationReference: "unknown_location_reference",
  unknownEntityChangeReference: "unknown_entity_change_reference",
  unknownRelatedEntityReference: "unknown_related_entity_reference",
} as const;
export type LeafStoryUnitReadinessFindingCode =
  (typeof LEAF_STORY_UNIT_READINESS_FINDING)[keyof typeof LEAF_STORY_UNIT_READINESS_FINDING];

export interface LeafStoryUnitReadinessFinding {
  readonly code: LeafStoryUnitReadinessFindingCode;
  readonly storyUnitId: StoryUnitId;
  readonly entityType?: "character" | "location";
  readonly entityId?: StoryEntityId;
}

export interface LeafStoryUnitReadinessResult {
  readonly status: LeafStoryUnitReadinessStatus;
  readonly findings: readonly LeafStoryUnitReadinessFinding[];
}

export interface LeafStoryUnitReadinessContext {
  readonly outline: StoryOutlineTree;
  readonly knownCharacterIds: readonly CharacterId[];
  readonly knownLocationIds: readonly LocationId[];
}

const LEAF_PLAN_KEYS = new Set([
  "storyUnitId",
  "settingMode",
  "time",
  "characters",
  "locations",
  "events",
  "rhythmBeats",
  "entityChanges",
]);
const REQUIRED_LEAF_PLAN_KEYS = [
  "storyUnitId",
  "settingMode",
  "characters",
  "locations",
  "events",
  "rhythmBeats",
  "entityChanges",
] as const;
const READINESS_CONTEXT_KEYS = new Set([
  "outline",
  "knownCharacterIds",
  "knownLocationIds",
]);
const STORY_SETTING_MODES = new Set<unknown>(Object.values(STORY_SETTING_MODE));

export function captureLeafStoryUnitPlan(value: unknown): LeafStoryUnitPlan {
  const candidate = captureExactObject(value, LEAF_PLAN_KEYS);
  if (
    REQUIRED_LEAF_PLAN_KEYS.some(
      (key) => !Object.prototype.hasOwnProperty.call(candidate, key),
    )
  ) {
    throw invalidLeafPlan();
  }
  const storyUnitId = captureStoryUnitId(candidate.storyUnitId);
  const events = captureOrderedStoryEventSteps(storyUnitId, candidate.events);
  const eventIds = events.map((event) => event.id);
  const time =
    candidate.time === undefined
      ? undefined
      : captureStoryTimeDescription(candidate.time);
  return Object.freeze({
    storyUnitId,
    settingMode: captureStorySettingMode(candidate.settingMode),
    ...(time === undefined ? {} : { time }),
    characters: captureStoryUnitCharacterBindings(
      storyUnitId,
      candidate.characters,
    ),
    locations: captureStoryUnitLocationBindings(storyUnitId, candidate.locations),
    events,
    rhythmBeats: captureOrderedRhythmBeats(
      storyUnitId,
      eventIds,
      candidate.rhythmBeats,
    ),
    entityChanges: captureStoryUnitEntityChanges(
      storyUnitId,
      eventIds,
      candidate.entityChanges,
    ),
  });
}

export function evaluateLeafStoryUnitReadiness(
  planInput: unknown,
  contextInput: unknown,
): LeafStoryUnitReadinessResult {
  const plan = captureLeafStoryUnitPlan(planInput);
  const context = captureReadinessContext(contextInput);
  const findings: LeafStoryUnitReadinessFinding[] = [];
  const findingKeys = new Set<string>();
  const unit = context.outline.getUnit(plan.storyUnitId);

  if (unit === undefined) {
    pushFinding(findings, findingKeys, {
      code: LEAF_STORY_UNIT_READINESS_FINDING.storyUnitMissing,
      storyUnitId: plan.storyUnitId,
    });
  } else if (context.outline.listChildren(plan.storyUnitId).length > 0) {
    pushFinding(findings, findingKeys, {
      code: LEAF_STORY_UNIT_READINESS_FINDING.storyUnitNotLeaf,
      storyUnitId: plan.storyUnitId,
    });
  }
  if (plan.time === undefined) {
    pushFinding(findings, findingKeys, {
      code: LEAF_STORY_UNIT_READINESS_FINDING.storyTimeMissing,
      storyUnitId: plan.storyUnitId,
    });
  }
  if (plan.events.length === 0) {
    pushFinding(findings, findingKeys, {
      code: LEAF_STORY_UNIT_READINESS_FINDING.storyEventMissing,
      storyUnitId: plan.storyUnitId,
    });
  }

  const primaryLocationCount = plan.locations.filter(
    (binding) => binding.involvement?.role === LOCATION_STORY_ROLE.primary,
  ).length;
  if (
    plan.settingMode === STORY_SETTING_MODE.located &&
    primaryLocationCount !== 1
  ) {
    pushFinding(findings, findingKeys, {
      code: LEAF_STORY_UNIT_READINESS_FINDING.locatedPrimaryLocationRequired,
      storyUnitId: plan.storyUnitId,
    });
  }
  if (
    plan.settingMode === STORY_SETTING_MODE.locationIndependent &&
    primaryLocationCount > 0
  ) {
    pushFinding(findings, findingKeys, {
      code:
        LEAF_STORY_UNIT_READINESS_FINDING.locationIndependentPrimaryLocationForbidden,
      storyUnitId: plan.storyUnitId,
    });
  }

  for (const binding of plan.characters) {
    if (!context.knownCharacterIds.has(binding.characterId)) {
      pushFinding(findings, findingKeys, {
        code: LEAF_STORY_UNIT_READINESS_FINDING.unknownCharacterReference,
        storyUnitId: plan.storyUnitId,
        entityType: "character",
        entityId: binding.characterId,
      });
    }
  }
  for (const binding of plan.locations) {
    if (!context.knownLocationIds.has(binding.locationId)) {
      pushFinding(findings, findingKeys, {
        code: LEAF_STORY_UNIT_READINESS_FINDING.unknownLocationReference,
        storyUnitId: plan.storyUnitId,
        entityType: "location",
        entityId: binding.locationId,
      });
    }
  }
  for (const change of plan.entityChanges) {
    const isKnownEntity =
      change.entityType === "character"
        ? context.knownCharacterIds.has(change.entityId)
        : context.knownLocationIds.has(change.entityId);
    if (!isKnownEntity) {
      pushFinding(findings, findingKeys, {
        code: LEAF_STORY_UNIT_READINESS_FINDING.unknownEntityChangeReference,
        storyUnitId: plan.storyUnitId,
        entityType: change.entityType,
        entityId: change.entityId,
      });
    }
    if (
      change.relatedEntityId !== undefined &&
      !context.knownCharacterIds.has(change.relatedEntityId as CharacterId) &&
      !context.knownLocationIds.has(change.relatedEntityId as LocationId)
    ) {
      pushFinding(findings, findingKeys, {
        code: LEAF_STORY_UNIT_READINESS_FINDING.unknownRelatedEntityReference,
        storyUnitId: plan.storyUnitId,
        entityId: change.relatedEntityId,
      });
    }
  }

  const capturedFindings = Object.freeze(findings);
  return Object.freeze({
    status:
      capturedFindings.length === 0
        ? LEAF_STORY_UNIT_READINESS_STATUS.ready
        : LEAF_STORY_UNIT_READINESS_STATUS.notReady,
    findings: capturedFindings,
  });
}

function captureReadinessContext(value: unknown): {
  outline: StoryOutlineTree;
  knownCharacterIds: ReadonlySet<CharacterId>;
  knownLocationIds: ReadonlySet<LocationId>;
} {
  const candidate = captureExactObject(value, READINESS_CONTEXT_KEYS);
  if (
    Object.keys(candidate).length !== READINESS_CONTEXT_KEYS.size ||
    !(candidate.outline instanceof StoryOutlineTree) ||
    !Array.isArray(candidate.knownCharacterIds) ||
    !Array.isArray(candidate.knownLocationIds)
  ) {
    throw invalidLeafPlan();
  }
  return {
    outline: candidate.outline,
    knownCharacterIds: new Set(candidate.knownCharacterIds.map(captureCharacterId)),
    knownLocationIds: new Set(candidate.knownLocationIds.map(captureLocationId)),
  };
}

function captureStorySettingMode(value: unknown): StorySettingMode {
  if (!STORY_SETTING_MODES.has(value)) throw invalidLeafPlan();
  return value as StorySettingMode;
}

function captureExactObject(
  value: unknown,
  keys: ReadonlySet<string>,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.has(key))
  ) {
    throw invalidLeafPlan();
  }
  return value as Record<string, unknown>;
}

function pushFinding(
  findings: LeafStoryUnitReadinessFinding[],
  findingKeys: Set<string>,
  finding: LeafStoryUnitReadinessFinding,
): void {
  const key = `${finding.code}:${finding.entityType ?? ""}:${finding.entityId ?? ""}`;
  if (findingKeys.has(key)) return;
  findingKeys.add(key);
  findings.push(Object.freeze(finding));
}

function invalidLeafPlan(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidLeafStoryUnitPlan,
    "leafStoryUnitPlan",
  );
}
