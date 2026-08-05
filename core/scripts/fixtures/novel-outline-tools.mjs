/** Shared fixture: Novel Outline + Character group manifests and unavailable-service registries for assembly tests. */
import {
  NOVEL_CHARACTER_TOOL_GROUP_MANIFEST,
  NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
  NovelCharacterToolService,
  OutlineToolService,
  captureCharacterId,
  captureStoryOutlineId,
  captureStoryUnitId,
  createNovelCharacterToolRegistry,
  createNovelOutlineToolRegistry,
} from "../../dist/index.js";

let fixtureCounter = 0;

const unavailable = () =>
  Promise.reject(
    new TypeError("Novel outline service is unavailable in assembly fixture"),
  );

const unavailableOutlineToolService = new OutlineToolService({
  outline: {
    createOutline: unavailable,
    createStoryUnit: unavailable,
    replaceStoryUnit: unavailable,
    moveStoryUnit: unavailable,
    deleteStoryUnit: unavailable,
    replaceLeafStoryUnitPlan: unavailable,
    clearLeafStoryUnitPlan: unavailable,
  },
  outlineQueries: {
    getOutline: unavailable,
    getTree: unavailable,
    getStoryUnit: unavailable,
    getLeafStoryUnitPlan: unavailable,
  },
  drafts: {
    startDraft: unavailable,
    getActiveDraft: unavailable,
    resetToMain: unavailable,
    rollback: unavailable,
  },
  identityFactory: {
    createStoryOutlineId: () => captureStoryOutlineId("fixture_outline"),
    createStoryUnitId: () => captureStoryUnitId(`fixture_story_unit_${fixtureCounter++}`),
  },
});

export const novelOutlineToolRegistry = createNovelOutlineToolRegistry({
  service: unavailableOutlineToolService,
});

const unavailableCharacterToolService = new NovelCharacterToolService({
  characters: {
    create: unavailable,
    replace: unavailable,
    delete: unavailable,
  },
  characterQueries: {
    get: unavailable,
    list: unavailable,
  },
  drafts: {
    startDraft: unavailable,
    getActiveDraft: unavailable,
    resetToMain: unavailable,
    rollback: unavailable,
  },
  identityFactory: {
    createCharacterId: () => captureCharacterId("fixture_character"),
  },
});

export const novelCharacterToolRegistry = createNovelCharacterToolRegistry({
  service: unavailableCharacterToolService,
});

export {
  NOVEL_CHARACTER_TOOL_GROUP_MANIFEST,
  NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
};
