/** Shared fixture: Novel Outline + Character group manifests and unavailable-service registries for assembly tests. */
import {
  NOVEL_CHARACTER_TOOL_GROUP_MANIFEST,
  NOVEL_LOCATION_TOOL_GROUP_MANIFEST,
  NOVEL_PARAGRAPH_TOOL_GROUP_MANIFEST,
  NOVEL_PUBLICATION_TOOL_GROUP_MANIFEST,
  NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
  NovelCharacterToolService,
  NovelLocationToolService,
  NovelParagraphToolService,
  NovelPublicationToolService,
  OutlineToolService,
  captureCharacterId,
  captureLocationId,
  captureParagraphId,
  capturePublicationChapterId,
  capturePublicationStructureId,
  capturePublicationVolumeId,
  captureStoryOutlineId,
  captureStoryUnitId,
  createNovelCharacterToolRegistry,
  createNovelLocationToolRegistry,
  createNovelOutlineToolRegistry,
  createNovelParagraphToolRegistry,
  createNovelPublicationToolRegistry,
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

const unavailableLocationToolService = new NovelLocationToolService({
  locations: {
    create: unavailable,
    replace: unavailable,
    delete: unavailable,
  },
  locationQueries: {
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
    createLocationId: () => captureLocationId("fixture_location"),
  },
});

export const novelLocationToolRegistry = createNovelLocationToolRegistry({
  service: unavailableLocationToolService,
});

const unavailableParagraphToolService = new NovelParagraphToolService({
  paragraphs: {
    createParagraph: unavailable,
    replaceText: unavailable,
    replaceOrder: unavailable,
    replaceStoryUnit: unavailable,
    deleteParagraph: unavailable,
  },
  paragraphQueries: {
    getCatalog: unavailable,
    getParagraph: unavailable,
    listParagraphsByStoryUnit: unavailable,
  },
  drafts: {
    startDraft: unavailable,
    getActiveDraft: unavailable,
    resetToMain: unavailable,
    rollback: unavailable,
  },
  identityFactory: {
    createParagraphId: () => captureParagraphId("fixture_paragraph"),
  },
});

const unavailablePublicationToolService = new NovelPublicationToolService({
  publication: {
    createPublication: unavailable,
    createVolume: unavailable,
    replaceVolume: unavailable,
    deleteVolume: unavailable,
    createChapter: unavailable,
    replaceChapter: unavailable,
    deleteChapter: unavailable,
  },
  publicationQueries: {
    getCatalog: unavailable,
    getVolume: unavailable,
    listVolumes: unavailable,
    getChapter: unavailable,
    listChapters: unavailable,
  },
  paragraphs: {
    getCatalog: unavailable,
    getParagraph: unavailable,
    listParagraphsByStoryUnit: unavailable,
  },
  drafts: {
    startDraft: unavailable,
    getActiveDraft: unavailable,
    resetToMain: unavailable,
    rollback: unavailable,
  },
  identityFactory: {
    createPublicationStructureId: () =>
      capturePublicationStructureId("fixture_publication"),
    createPublicationVolumeId: () => capturePublicationVolumeId("fixture_volume"),
    createPublicationChapterId: () => capturePublicationChapterId("fixture_chapter"),
  },
});

export const novelParagraphToolRegistry = createNovelParagraphToolRegistry({
  service: unavailableParagraphToolService,
});

export const novelPublicationToolRegistry = createNovelPublicationToolRegistry({
  service: unavailablePublicationToolService,
});

export {
  NOVEL_CHARACTER_TOOL_GROUP_MANIFEST,
  NOVEL_LOCATION_TOOL_GROUP_MANIFEST,
  NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
  NOVEL_PARAGRAPH_TOOL_GROUP_MANIFEST,
  NOVEL_PUBLICATION_TOOL_GROUP_MANIFEST,
};
