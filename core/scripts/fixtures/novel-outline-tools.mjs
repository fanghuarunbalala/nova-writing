/** Shared fixture: Novel Outline group manifest and an unavailable-service registry for assembly tests. */
import {
  NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
  OutlineToolService,
  captureStoryOutlineId,
  captureStoryUnitId,
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

export { NOVEL_OUTLINE_TOOL_GROUP_MANIFEST };
