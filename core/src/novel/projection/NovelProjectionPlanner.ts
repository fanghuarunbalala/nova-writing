/** Rebuilds revision-bound projections from authoritative profiles, outline, and evidence. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../error/index.js";
import {
  captureCharacterId,
  captureLocationId,
  captureStoryEntityId,
  captureStoryUnitId,
  type CharacterId,
  type LocationId,
  type StoryEntityId,
  type StoryUnitId,
} from "../identity/index.js";
import {
  captureCharacter,
  captureLocation,
  type Character,
  type Location,
} from "../model/entity/index.js";
import {
  STORY_ENTITY_CHANGE_CATEGORY,
  STORY_UNIT_REALIZATION_STATUS,
  captureStoryUnitCharacterBinding,
  captureStoryUnitEntityChange,
  captureStoryUnitLocationBinding,
  STORY_UNIT_PLANNING_STATUS,
  type StoryOutlineTree,
  type StoryUnit,
  type StoryUnitCharacterBinding,
  type StoryUnitEntityChange,
  type StoryUnitLocationBinding,
} from "../model/outline/index.js";
import {
  STORY_UNIT_CONFORMANCE_SEVERITY,
  STORY_UNIT_CONFORMANCE_STATUS,
  captureParagraph,
  type Paragraph,
} from "../model/index.js";
import { StoryUnitConformanceEvaluator } from "../validation/index.js";
import {
  captureNovelRevision,
  type NovelRevision,
} from "../version/index.js";
import {
  NOVEL_PROJECTION_FRESHNESS,
  NOVEL_PROJECTION_MODE,
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

export interface EntityProfileReadinessPolicy {
  evaluateCharacter(input: {
    readonly character: Character;
    readonly storyUnit: StoryUnit;
    readonly binding?: StoryUnitCharacterBinding;
  }): readonly string[];
  evaluateLocation(input: {
    readonly location: Location;
    readonly storyUnit: StoryUnit;
    readonly binding?: StoryUnitLocationBinding;
  }): readonly string[];
}

export interface NovelProjectionSourceSnapshot {
  readonly currentRevision: NovelRevision;
  readonly characters: readonly Character[];
  readonly locations: readonly Location[];
  readonly entityChanges: readonly StoryUnitEntityChange[];
  readonly paragraphs: readonly Paragraph[];
  readonly characterBindings: readonly StoryUnitCharacterBinding[];
  readonly locationBindings: readonly StoryUnitLocationBinding[];
}

const SOURCE_KEYS = new Set([
  "currentRevision",
  "characters",
  "locations",
  "entityChanges",
  "paragraphs",
  "characterBindings",
  "locationBindings",
]);

export class NovelProjectionPlanner {
  private readonly source: NovelProjectionSourceSnapshot;
  private readonly charactersById: ReadonlyMap<CharacterId, Character>;
  private readonly locationsById: ReadonlyMap<LocationId, Location>;
  private readonly paragraphsByStoryUnitId: ReadonlyMap<
    StoryUnitId,
    readonly Paragraph[]
  >;
  private readonly conformanceEvaluator: StoryUnitConformanceEvaluator;
  private readonly characterBindingsByKey: ReadonlyMap<
    string,
    StoryUnitCharacterBinding
  >;
  private readonly locationBindingsByKey: ReadonlyMap<
    string,
    StoryUnitLocationBinding
  >;
  private readonly orderedUnits: readonly StoryUnit[];
  private readonly unitIndexById: ReadonlyMap<StoryUnitId, number>;

  constructor(
    private readonly outline: StoryOutlineTree,
    value: unknown,
    private readonly readinessPolicy: EntityProfileReadinessPolicy,
  ) {
    this.source = captureSource(value);
    this.conformanceEvaluator = new StoryUnitConformanceEvaluator();
    const indexed = indexSource(this.source, outline);
    this.charactersById = indexed.charactersById;
    this.locationsById = indexed.locationsById;
    this.paragraphsByStoryUnitId = indexed.paragraphsByStoryUnitId;
    this.characterBindingsByKey = indexed.characterBindingsByKey;
    this.locationBindingsByKey = indexed.locationBindingsByKey;
    this.orderedUnits = outline.listDepthFirst();
    this.unitIndexById = new Map(
      this.orderedUnits.map((unit, index) => [unit.id, index]),
    );
  }

  projectCharacterState(input: {
    readonly characterId: CharacterId;
    readonly atStoryUnitId: StoryUnitId;
    readonly mode: NovelProjectionMode;
  }): CharacterCurrentStateProjection | undefined {
    const characterId = captureCharacterId(input.characterId);
    const character = this.charactersById.get(characterId);
    const target = this.getTarget(input.atStoryUnitId);
    if (character === undefined || target === undefined) return undefined;
    const mode = captureNovelProjectionMode(input.mode);
    const changes = this.selectEntityChanges(characterId, target.id, mode);
    return captureCharacterCurrentStateProjection({
      entityType: "character",
      characterId,
      atStoryUnitId: target.id,
      mode,
      sourceRevision: this.source.currentRevision,
      summary: buildStateSummary(character, changes),
      evidenceStoryUnitIds: evidenceStoryUnitIds(changes),
    });
  }

  projectLocationState(input: {
    readonly locationId: LocationId;
    readonly atStoryUnitId: StoryUnitId;
    readonly mode: NovelProjectionMode;
  }): LocationCurrentStateProjection | undefined {
    const locationId = captureLocationId(input.locationId);
    const location = this.locationsById.get(locationId);
    const target = this.getTarget(input.atStoryUnitId);
    if (location === undefined || target === undefined) return undefined;
    const mode = captureNovelProjectionMode(input.mode);
    const changes = this.selectEntityChanges(locationId, target.id, mode);
    return captureLocationCurrentStateProjection({
      entityType: "location",
      locationId,
      atStoryUnitId: target.id,
      mode,
      sourceRevision: this.source.currentRevision,
      summary: buildStateSummary(location, changes),
      evidenceStoryUnitIds: evidenceStoryUnitIds(changes),
    });
  }

  projectReadiness(input: {
    readonly entityType: "character" | "location";
    readonly entityId: StoryEntityId;
    readonly forStoryUnitId: StoryUnitId;
  }): EntityProfileReadinessProjection | undefined {
    const storyUnit = this.getTarget(input.forStoryUnitId);
    if (storyUnit === undefined) return undefined;
    if (input.entityType === "character") {
      const entityId = captureCharacterId(input.entityId);
      const character = this.charactersById.get(entityId);
      if (character === undefined) return undefined;
      const binding = this.characterBindingsByKey.get(
        bindingKey(storyUnit.id, entityId),
      );
      return readinessProjection(
        "character",
        entityId,
        storyUnit.id,
        this.source.currentRevision,
        this.readinessPolicy.evaluateCharacter({ character, storyUnit, binding }),
      );
    }
    const entityId = captureLocationId(input.entityId);
    const location = this.locationsById.get(entityId);
    if (location === undefined) return undefined;
    const binding = this.locationBindingsByKey.get(
      bindingKey(storyUnit.id, entityId),
    );
    return readinessProjection(
      "location",
      entityId,
      storyUnit.id,
      this.source.currentRevision,
      this.readinessPolicy.evaluateLocation({ location, storyUnit, binding }),
    );
  }

  projectCharacterRelationship(input: {
    readonly focusCharacterId: CharacterId;
    readonly relatedCharacterId: CharacterId;
    readonly atStoryUnitId: StoryUnitId;
    readonly mode: NovelProjectionMode;
  }): CharacterRelationshipProjection | undefined {
    const focusCharacterId = captureCharacterId(input.focusCharacterId);
    const relatedCharacterId = captureCharacterId(input.relatedCharacterId);
    const target = this.getTarget(input.atStoryUnitId);
    if (
      target === undefined ||
      this.charactersById.get(focusCharacterId) === undefined ||
      this.charactersById.get(relatedCharacterId) === undefined
    ) {
      return undefined;
    }
    const mode = captureNovelProjectionMode(input.mode);
    const eligible = this.eligibleStoryUnitIds(target.id, mode);
    const changes = this.source.entityChanges.filter((change) =>
      eligible.has(change.storyUnitId) &&
      change.entityType === "character" &&
      change.category === STORY_ENTITY_CHANGE_CATEGORY.relationship &&
      ((change.entityId === focusCharacterId &&
        change.relatedEntityId === relatedCharacterId) ||
        (change.entityId === relatedCharacterId &&
          change.relatedEntityId === focusCharacterId))
    );
    return captureCharacterRelationshipProjection({
      focusCharacterId,
      relatedCharacterId,
      atStoryUnitId: target.id,
      mode,
      sourceRevision: this.source.currentRevision,
      summary: changes.length === 0
        ? "No relationship changes are recorded in the selected scope."
        : changes.map((change) => change.summary).join("\n"),
      evidenceStoryUnitIds: evidenceStoryUnitIds(changes),
    });
  }

  projectStoryUnitConformance(
    storyUnitIdInput: StoryUnitId,
  ): StoryUnitConformanceProjection | undefined {
    const storyUnitId = captureStoryUnitId(storyUnitIdInput);
    if (this.outline.getUnit(storyUnitId) === undefined) return undefined;
    const paragraphs = this.paragraphsByStoryUnitId.get(storyUnitId) ?? [];
    const unit = this.outline.getUnit(storyUnitId);
    const hasAcceptedPlan = unit?.planningStatus === STORY_UNIT_PLANNING_STATUS.ready;
    const conformance = this.conformanceEvaluator.evaluate({
      paragraphs,
      hasAcceptedPlan,
      currentRevision: this.source.currentRevision,
    });
    const freshness = conformance.checkedNovelRevision === this.source.currentRevision
      ? NOVEL_PROJECTION_FRESHNESS.current
      : NOVEL_PROJECTION_FRESHNESS.stale;
    return captureStoryUnitConformanceProjection({
      storyUnitId,
      sourceRevision: this.source.currentRevision,
      freshness,
      validationStatus: conformance.status,
      warningCount: conformance.findings.filter(
        (finding) =>
          finding.severity === STORY_UNIT_CONFORMANCE_SEVERITY.warning,
      ).length,
      errorCount: conformance.findings.filter(
        (finding) => finding.severity === STORY_UNIT_CONFORMANCE_SEVERITY.error,
      ).length,
      evidenceStoryUnitIds: [storyUnitId],
    });
  }

  private getTarget(storyUnitId: StoryUnitId): StoryUnit | undefined {
    return this.outline.getUnit(captureStoryUnitId(storyUnitId));
  }

  private selectEntityChanges(
    entityId: StoryEntityId,
    atStoryUnitId: StoryUnitId,
    mode: NovelProjectionMode,
  ): readonly StoryUnitEntityChange[] {
    const eligible = this.eligibleStoryUnitIds(atStoryUnitId, mode);
    return this.source.entityChanges.filter(
      (change) => change.entityId === entityId && eligible.has(change.storyUnitId),
    );
  }

  private eligibleStoryUnitIds(
    atStoryUnitId: StoryUnitId,
    mode: NovelProjectionMode,
  ): ReadonlySet<StoryUnitId> {
    const targetIndex = this.unitIndexById.get(atStoryUnitId);
    if (targetIndex === undefined) return new Set();
    const eligible = new Set<StoryUnitId>();
    for (const unit of this.orderedUnits.slice(0, targetIndex + 1)) {
      if (
        this.outline.listChildren(unit.id).length > 0 ||
        this.outline.getProgress(unit.id)?.effectiveStatus ===
          STORY_UNIT_REALIZATION_STATUS.abandoned
      ) {
        continue;
      }
      if (mode === NOVEL_PROJECTION_MODE.planned || this.isConfirmed(unit)) {
        eligible.add(unit.id);
      }
    }
    return eligible;
  }

  private isConfirmed(unit: StoryUnit): boolean {
    const paragraphs = this.paragraphsByStoryUnitId.get(unit.id) ?? [];
    const conformance = this.conformanceEvaluator.evaluate({
      paragraphs,
      hasAcceptedPlan: unit.planningStatus === STORY_UNIT_PLANNING_STATUS.ready,
      currentRevision: this.source.currentRevision,
    });
    return unit.realizationStatus === STORY_UNIT_REALIZATION_STATUS.completed &&
      paragraphs.length > 0 &&
      conformance.checkedNovelRevision === this.source.currentRevision &&
      conformance.status === STORY_UNIT_CONFORMANCE_STATUS.conforming;
  }
}

function captureSource(value: unknown): NovelProjectionSourceSnapshot {
  const candidate = captureRecord(value);
  for (const key of [
    "characters",
    "locations",
    "entityChanges",
    "paragraphs",
    "characterBindings",
    "locationBindings",
  ]) {
    captureDenseArray(candidate[key]);
  }
  return Object.freeze({
    currentRevision: captureNovelRevision(candidate.currentRevision),
    characters: Object.freeze(candidate.characters.map((item) =>
      captureCharacter(item as Character)
    )),
    locations: Object.freeze(candidate.locations.map((item) =>
      captureLocation(item as Location)
    )),
    entityChanges: Object.freeze(
      candidate.entityChanges.map(captureStoryUnitEntityChange),
    ),
    paragraphs: Object.freeze(
      candidate.paragraphs.map(captureParagraph),
    ),
    characterBindings: Object.freeze(
      candidate.characterBindings.map(captureStoryUnitCharacterBinding),
    ),
    locationBindings: Object.freeze(
      candidate.locationBindings.map(captureStoryUnitLocationBinding),
    ),
  });
}

function indexSource(
  source: NovelProjectionSourceSnapshot,
  outline: StoryOutlineTree,
) {
  const charactersById = uniqueMap(source.characters, (entity) => entity.id);
  const locationsById = uniqueMap(source.locations, (entity) => entity.id);
  const paragraphsByStoryUnitId = indexParagraphs(source.paragraphs);
  const characterBindingsByKey = uniqueMap(
    source.characterBindings,
    (binding) => bindingKey(binding.storyUnitId, binding.characterId),
  );
  const locationBindingsByKey = uniqueMap(
    source.locationBindings,
    (binding) => bindingKey(binding.storyUnitId, binding.locationId),
  );
  for (const paragraph of source.paragraphs) {
    if (outline.getUnit(paragraph.storyUnitId) === undefined) {
      throw invalidProjection();
    }
  }
  for (const change of source.entityChanges) {
    if (
      outline.getUnit(change.storyUnitId) === undefined ||
      outline.listChildren(change.storyUnitId).length > 0 ||
      !hasEntity(change.entityId, charactersById, locationsById) ||
      (change.relatedEntityId !== undefined &&
        !hasEntity(change.relatedEntityId, charactersById, locationsById))
    ) {
      throw invalidProjection();
    }
  }
  for (const binding of source.characterBindings) {
    if (
      outline.getUnit(binding.storyUnitId) === undefined ||
      !charactersById.has(binding.characterId)
    ) {
      throw invalidProjection();
    }
  }
  for (const binding of source.locationBindings) {
    if (
      outline.getUnit(binding.storyUnitId) === undefined ||
      !locationsById.has(binding.locationId)
    ) {
      throw invalidProjection();
    }
  }
  return {
    charactersById,
    locationsById,
    paragraphsByStoryUnitId,
    characterBindingsByKey,
    locationBindingsByKey,
  };
}

function indexParagraphs(
  paragraphs: readonly Paragraph[],
): ReadonlyMap<StoryUnitId, readonly Paragraph[]> {
  const byStoryUnitId = new Map<StoryUnitId, Paragraph[]>();
  for (const paragraph of paragraphs) {
    const existing = byStoryUnitId.get(paragraph.storyUnitId) ?? [];
    existing.push(paragraph);
    byStoryUnitId.set(paragraph.storyUnitId, existing);
  }
  const frozen = new Map<StoryUnitId, readonly Paragraph[]>();
  for (const [storyUnitId, values] of byStoryUnitId) {
    frozen.set(storyUnitId, Object.freeze(values));
  }
  return frozen;
}

function uniqueMap<T, K>(
  values: readonly T[],
  keyOf: (value: T) => K,
): ReadonlyMap<K, T> {
  const result = new Map<K, T>();
  for (const value of values) {
    const key = keyOf(value);
    if (result.has(key)) throw invalidProjection();
    result.set(key, value);
  }
  return result;
}

function hasEntity(
  entityId: StoryEntityId,
  characters: ReadonlyMap<CharacterId, Character>,
  locations: ReadonlyMap<LocationId, Location>,
): boolean {
  return characters.has(entityId as CharacterId) ||
    locations.has(entityId as LocationId);
}

function readinessProjection(
  entityType: "character" | "location",
  entityId: StoryEntityId,
  storyUnitId: StoryUnitId,
  sourceRevision: NovelRevision,
  missingInformation: readonly string[],
): EntityProfileReadinessProjection {
  return captureEntityProfileReadinessProjection({
    entityType,
    entityId: captureStoryEntityId(entityId),
    forStoryUnitId: storyUnitId,
    sourceRevision,
    status: missingInformation.length === 0 ? "sufficient" : "insufficient",
    missingInformation: [...missingInformation],
    evidenceStoryUnitIds: [storyUnitId],
  });
}

function buildStateSummary(
  entity: Character | Location,
  changes: readonly StoryUnitEntityChange[],
): string {
  return [
    entity.initialState ?? entity.summary ?? entity.name,
    ...changes.map((change) => change.summary),
  ].join("\n");
}

function evidenceStoryUnitIds(
  changes: readonly StoryUnitEntityChange[],
): readonly StoryUnitId[] {
  const evidence: StoryUnitId[] = [];
  const seen = new Set<StoryUnitId>();
  for (const change of changes) {
    if (!seen.has(change.storyUnitId)) {
      seen.add(change.storyUnitId);
      evidence.push(change.storyUnitId);
    }
  }
  return evidence;
}

function bindingKey(storyUnitId: StoryUnitId, entityId: StoryEntityId): string {
  return `${storyUnitId}:${entityId}`;
}

function captureRecord(value: unknown): Record<string, unknown[]> & {
  currentRevision: unknown;
} {
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
    Object.keys(value).some((key) => !SOURCE_KEYS.has(key))
  ) {
    throw invalidProjection();
  }
  return value as Record<string, unknown[]> & { currentRevision: unknown };
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

function invalidProjection(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidNovelProjection,
    "novelProjection",
  );
}
