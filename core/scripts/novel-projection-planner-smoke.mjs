import assert from "node:assert/strict";
import {
  FractionalOrderKeyFactory,
  ManuscriptCatalog,
  ManuscriptRangeRepairValidator,
  ManuscriptRepairCatalog,
  NovelProjectionPlanner,
  NovelProtocolValidationError,
  PublicationCatalog,
  StoryOutlineTree,
  captureCharacter,
  captureCharacterId,
  captureLocation,
  captureLocationId,
  captureManuscript,
  captureManuscriptBlockId,
  captureManuscriptId,
  captureNovelEntityVersion,
  captureNovelId,
  captureNovelRevision,
  captureNovelTimestamp,
  captureParagraphBlock,
  capturePublicationChapter,
  capturePublicationChapterId,
  capturePublicationStructure,
  capturePublicationStructureId,
  capturePublicationVolume,
  capturePublicationVolumeId,
  captureStoryEventStepId,
  captureStoryOutline,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitEntityChange,
  captureStoryUnitEntityChangeId,
  captureStoryUnitId,
  captureStoryUnitRealization,
} from "../dist/index.js";

const orders = new FractionalOrderKeyFactory();
const first = orders.initial();
const second = orders.after(first);
const third = orders.after(second);
const currentRevision = captureNovelRevision("revision_projection_current");
const oldRevision = captureNovelRevision("revision_projection_old");
const novelId = captureNovelId("novel_projection_planner");
const outline = captureStoryOutline({
  id: captureStoryOutlineId("outline_projection_planner"),
  novelId,
});
const root = storyUnit("root", undefined, first, "in-progress");
const completedLeaf = storyUnit("completed", root.id, first, "completed");
const plannedLeaf = storyUnit("planned", root.id, second, "in-progress");
const staleLeaf = storyUnit("stale", root.id, third, "completed");
const tree = new StoryOutlineTree({
  outline,
  units: [root, completedLeaf, plannedLeaf, staleLeaf],
});

const publication = capturePublicationStructure({
  id: capturePublicationStructureId("publication_projection_planner"),
  novelId,
});
const volume = capturePublicationVolume({
  id: capturePublicationVolumeId("volume_projection_planner"),
  publicationId: publication.id,
  orderKey: first,
  title: "Volume",
});
const chapter = capturePublicationChapter({
  id: capturePublicationChapterId("chapter_projection_planner"),
  publicationId: publication.id,
  volumeId: volume.id,
  orderKey: first,
  title: "Chapter",
});
const publicationCatalog = new PublicationCatalog({
  publication,
  volumes: [volume],
  chapters: [chapter],
});
const manuscript = captureManuscript({
  id: captureManuscriptId("manuscript_projection_planner"),
  novelId,
  publicationId: publication.id,
});
const completedBlock = block("block_completed", first);
const staleBlock = block("block_stale", second);
const manuscriptCatalog = new ManuscriptCatalog({
  manuscript,
  blocks: [staleBlock, completedBlock],
}, publicationCatalog);
const repairCatalog = new ManuscriptRepairCatalog(
  { tombstones: [], redirects: [] },
  manuscriptCatalog,
);
const rangeValidator = new ManuscriptRangeRepairValidator(
  manuscriptCatalog,
  repairCatalog,
);

const protagonist = character("character_protagonist", "Protagonist", undefined);
const ally = character("character_ally", "Ally", "Healthy and cautious.");
const harbor = location("location_harbor", "Harbor", "Open to the public.");
const changes = [
  change("completed_condition", completedLeaf.id, "character", protagonist.id,
    "condition", "The protagonist is injured."),
  change("completed_relationship", completedLeaf.id, "character", protagonist.id,
    "relationship", "The ally earns the protagonist's trust.", ally.id),
  change("completed_location", completedLeaf.id, "location", harbor.id,
    "environment", "A storm damages the harbor."),
  change("planned_goal", plannedLeaf.id, "character", protagonist.id,
    "goal", "The protagonist plans a rescue."),
  change("planned_relationship", plannedLeaf.id, "character", ally.id,
    "relationship", "The rescue plan strains their trust.", protagonist.id),
  change("planned_location", plannedLeaf.id, "location", harbor.id,
    "ownership", "The rebels expect to seize the harbor."),
  change("stale_condition", staleLeaf.id, "character", protagonist.id,
    "condition", "This stale evidence must not be confirmed."),
];
const realizations = [
  realization(
    completedLeaf.id,
    currentRevision,
    completedBlock.id,
    "conforming",
    [{
      type: "rhythm-mismatch",
      severity: "warning",
      note: "Accepted pacing variation.",
      manuscriptRanges: [],
    }],
  ),
  realization(staleLeaf.id, oldRevision, staleBlock.id, "conforming", []),
];
const source = {
  currentRevision,
  characters: [ally, protagonist],
  locations: [harbor],
  entityChanges: changes,
  realizations,
  characterBindings: [{
    storyUnitId: plannedLeaf.id,
    characterId: protagonist.id,
    involvement: {
      presence: "present",
      roles: ["point-of-view", "participant"],
    },
  }],
  locationBindings: [{
    storyUnitId: plannedLeaf.id,
    locationId: harbor.id,
    involvement: { role: "primary", affected: true },
  }],
};
const readinessPolicy = {
  evaluateCharacter({ character: entity, binding }) {
    return binding?.involvement?.roles.includes("point-of-view") &&
        entity.initialState === undefined
      ? ["initial state for point-of-view scene"]
      : [];
  },
  evaluateLocation({ location: entity, binding }) {
    return binding?.involvement?.role === "primary" && entity.summary === undefined
      ? ["spatial guidance"]
      : [];
  },
};
const planner = new NovelProjectionPlanner(
  tree,
  source,
  rangeValidator,
  readinessPolicy,
);

const confirmedCharacter = planner.projectCharacterState({
  characterId: protagonist.id,
  atStoryUnitId: plannedLeaf.id,
  mode: "confirmed",
});
assert.deepEqual(confirmedCharacter.evidenceStoryUnitIds, [completedLeaf.id]);
assert.match(confirmedCharacter.summary, /injured/u);
assert.doesNotMatch(confirmedCharacter.summary, /rescue/u);

const plannedCharacter = planner.projectCharacterState({
  characterId: protagonist.id,
  atStoryUnitId: plannedLeaf.id,
  mode: "planned",
});
assert.deepEqual(plannedCharacter.evidenceStoryUnitIds, [
  completedLeaf.id,
  plannedLeaf.id,
]);
assert.match(plannedCharacter.summary, /rescue/u);

const confirmedLocation = planner.projectLocationState({
  locationId: harbor.id,
  atStoryUnitId: plannedLeaf.id,
  mode: "confirmed",
});
assert.deepEqual(confirmedLocation.evidenceStoryUnitIds, [completedLeaf.id]);
const plannedLocation = planner.projectLocationState({
  locationId: harbor.id,
  atStoryUnitId: plannedLeaf.id,
  mode: "planned",
});
assert.deepEqual(plannedLocation.evidenceStoryUnitIds, [
  completedLeaf.id,
  plannedLeaf.id,
]);

const confirmedRelationship = planner.projectCharacterRelationship({
  focusCharacterId: protagonist.id,
  relatedCharacterId: ally.id,
  atStoryUnitId: plannedLeaf.id,
  mode: "confirmed",
});
assert.deepEqual(confirmedRelationship.evidenceStoryUnitIds, [completedLeaf.id]);
assert.doesNotMatch(confirmedRelationship.summary, /strains/u);
const plannedRelationship = planner.projectCharacterRelationship({
  focusCharacterId: protagonist.id,
  relatedCharacterId: ally.id,
  atStoryUnitId: plannedLeaf.id,
  mode: "planned",
});
assert.deepEqual(plannedRelationship.evidenceStoryUnitIds, [
  completedLeaf.id,
  plannedLeaf.id,
]);

const readiness = planner.projectReadiness({
  entityType: "character",
  entityId: protagonist.id,
  forStoryUnitId: plannedLeaf.id,
});
assert.equal(readiness.status, "insufficient");
assert.deepEqual(readiness.missingInformation, [
  "initial state for point-of-view scene",
]);
assert.equal(planner.projectReadiness({
  entityType: "location",
  entityId: harbor.id,
  forStoryUnitId: plannedLeaf.id,
}).status, "sufficient");

const currentConformance = planner.projectStoryUnitConformance(completedLeaf.id);
assert.equal(currentConformance.freshness, "current");
assert.equal(currentConformance.warningCount, 1);
assert.deepEqual(currentConformance.rangeStatuses, ["valid"]);
const pendingConformance = planner.projectStoryUnitConformance(plannedLeaf.id);
assert.equal(pendingConformance.validationStatus, "pending");
const staleConformance = planner.projectStoryUnitConformance(staleLeaf.id);
assert.equal(staleConformance.freshness, "stale");

assert.equal(planner.projectCharacterState({
  characterId: captureCharacterId("missing_character"),
  atStoryUnitId: plannedLeaf.id,
  mode: "confirmed",
}), undefined);

const secondPlanner = new NovelProjectionPlanner(
  tree,
  source,
  rangeValidator,
  readinessPolicy,
);
assert.deepEqual(
  secondPlanner.projectCharacterState({
    characterId: protagonist.id,
    atStoryUnitId: plannedLeaf.id,
    mode: "planned",
  }),
  plannedCharacter,
);

for (const invalidSource of [
  { ...source, characters: [protagonist, protagonist] },
  {
    ...source,
    entityChanges: [change(
      "root_change",
      root.id,
      "character",
      protagonist.id,
      "condition",
      "Composite changes are invalid.",
    )],
  },
  {
    ...source,
    characterBindings: [
      source.characterBindings[0],
      source.characterBindings[0],
    ],
  },
]) {
  assert.throws(
    () => new NovelProjectionPlanner(
      tree,
      invalidSource,
      rangeValidator,
      readinessPolicy,
    ),
    (error) => error instanceof NovelProtocolValidationError &&
      error.failure === "invalid_novel_projection",
  );
}

function storyUnit(label, parentId, orderKey, realizationStatus) {
  return captureStoryUnit({
    id: captureStoryUnitId(`story_unit_${label}`),
    outlineId: outline.id,
    ...(parentId === undefined ? {} : { parentId }),
    orderKey,
    title: label,
    planningStatus: "ready",
    realizationStatus,
  });
}

function block(id, orderKey) {
  return captureParagraphBlock({
    id: captureManuscriptBlockId(id),
    manuscriptId: manuscript.id,
    chapterId: chapter.id,
    orderKey,
    text: id,
  });
}

function character(id, name, initialState) {
  const timestamp = captureNovelTimestamp("2026-08-03T00:00:00.000Z");
  return captureCharacter({
    id: captureCharacterId(id),
    name,
    aliases: [],
    summary: `${name} summary.`,
    ...(initialState === undefined ? {} : { initialState }),
    entityVersion: captureNovelEntityVersion(1),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function location(id, name, initialState) {
  const timestamp = captureNovelTimestamp("2026-08-03T00:00:00.000Z");
  return captureLocation({
    id: captureLocationId(id),
    name,
    aliases: [],
    summary: `${name} summary.`,
    initialState,
    entityVersion: captureNovelEntityVersion(1),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function change(id, storyUnitId, entityType, entityId, category, summary, relatedEntityId) {
  return captureStoryUnitEntityChange({
    id: captureStoryUnitEntityChangeId(id),
    storyUnitId,
    entityType,
    entityId,
    ...(relatedEntityId === undefined ? {} : { relatedEntityId }),
    category,
    summary,
    sourceEventIds: [captureStoryEventStepId(`${id}_event`)],
  });
}

function realization(storyUnitId, revision, blockId, status, findings) {
  return captureStoryUnitRealization({
    storyUnitId,
    ranges: [{
      start: { blockId, boundary: "before" },
      end: { blockId, boundary: "after" },
    }],
    sourceRevision: revision,
    validation: {
      status,
      checkedNovelRevision: revision,
      findings,
    },
  });
}

console.log("novel projection planner smoke passed");
