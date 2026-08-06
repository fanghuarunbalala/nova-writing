/** Production assembly dependencies for the default Novel Conversation Agent. */
import {
  SystemPromptBuilder,
  createDefaultPromptSectionRegistry,
  type PromptDigester,
} from "../../../prompt/index.js";
import {
  type CharacterQueryService,
  type CharacterService,
  type LocationQueryService,
  type LocationService,
  type NovelDraftSessionService,
  type ParagraphQueryService,
  type ParagraphService,
  type PublicationQueryService,
  type PublicationService,
  type StoryOutlineQueryService,
  type StoryOutlineService,
  captureCharacterId,
  captureLocationId,
  captureParagraphId,
  capturePublicationChapterId,
  capturePublicationStructureId,
  capturePublicationVolumeId,
  captureStoryOutlineId,
  captureStoryUnitId,
} from "../../../novel/index.js";
import type { ConversationTodoWriter } from "../../../runtime/todo/index.js";
import { ToolGroupCatalog } from "../../../tooling/group/index.js";
import { loadToolGroupManifest } from "../../../tooling/group/index.js";
import { ToolRegistry } from "../../../tooling/registry/index.js";
import {
  NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
  OutlineToolService,
  createNovelOutlineToolRegistry,
} from "../../../tools/novel/index.js";
import {
  NOVEL_CHARACTER_TOOL_GROUP_MANIFEST,
  NovelCharacterToolService,
  createNovelCharacterToolRegistry,
} from "../../../tools/novel/index.js";
import {
  NOVEL_LOCATION_TOOL_GROUP_MANIFEST,
  NovelLocationToolService,
  createNovelLocationToolRegistry,
} from "../../../tools/novel/index.js";
import {
  NOVEL_DELETE_TOOL_GROUP_MANIFEST,
  NOVEL_PARAGRAPH_TOOL_GROUP_MANIFEST,
  NovelParagraphToolService,
  NovelDeleteToolService,
  createNovelParagraphToolRegistry,
  createNovelDeleteToolRegistry,
} from "../../../tools/novel/index.js";
import {
  NOVEL_PUBLICATION_TOOL_GROUP_MANIFEST,
  NovelPublicationToolService,
  createNovelPublicationToolRegistry,
} from "../../../tools/novel/index.js";
import { createTodoWriteTool } from "../../../tools/todo/index.js";
import { NodeSha256PromptDigester } from "../../prompt/index.js";

export interface NovelConversationManifestComposition {
  readonly registry: ToolRegistry;
  readonly groups: ToolGroupCatalog;
  readonly promptBuilder: SystemPromptBuilder;
  readonly digester: PromptDigester;
}

export interface CreateNovelConversationManifestCompositionOptions {
  readonly todoWriter?: ConversationTodoWriter;
}

const NOVEL_CONVERSATION_TOOL_GROUP_MANIFEST = `
schemaVersion: 1
id: runtime.todo
version: 1.0.0
label: Runtime todo tools
tools: [TodoWrite]
`;

const unavailableTodoWriter: ConversationTodoWriter = Object.freeze({
  replace() {
    return Promise.reject(
      new TypeError(
        "Conversation todo writer is unavailable during manifest assembly",
      ),
    );
  },
});

const unavailableNovelService = () =>
  Promise.reject(
    new TypeError(
      "Novel outline service is unavailable during manifest assembly",
    ),
  );

const unavailableStoryOutlineService = Object.freeze({
  createOutline: unavailableNovelService,
  createStoryUnit: unavailableNovelService,
  replaceStoryUnit: unavailableNovelService,
  moveStoryUnit: unavailableNovelService,
  deleteStoryUnit: unavailableNovelService,
  replaceLeafStoryUnitPlan: unavailableNovelService,
  clearLeafStoryUnitPlan: unavailableNovelService,
}) as unknown as StoryOutlineService;

const unavailableStoryOutlineQueryService = Object.freeze({
  getOutline: unavailableNovelService,
  getTree: unavailableNovelService,
  getStoryUnit: unavailableNovelService,
  getLeafStoryUnitPlan: unavailableNovelService,
}) as unknown as StoryOutlineQueryService;

const unavailableNovelDraftSessionService = Object.freeze({
  startDraft: unavailableNovelService,
  getActiveDraft: unavailableNovelService,
  resetToMain: unavailableNovelService,
  rollback: unavailableNovelService,
}) as unknown as NovelDraftSessionService;

const unavailableCharacterService = Object.freeze({
  create: unavailableNovelService,
  replace: unavailableNovelService,
  delete: unavailableNovelService,
}) as unknown as CharacterService;

const unavailableCharacterQueryService = Object.freeze({
  get: unavailableNovelService,
  list: unavailableNovelService,
}) as unknown as CharacterQueryService;

const unavailableLocationService = Object.freeze({
  create: unavailableNovelService,
  replace: unavailableNovelService,
  delete: unavailableNovelService,
}) as unknown as LocationService;

const unavailableLocationQueryService = Object.freeze({
  get: unavailableNovelService,
  list: unavailableNovelService,
}) as unknown as LocationQueryService;

const unavailableParagraphService = Object.freeze({
  createParagraph: unavailableNovelService,
  replaceText: unavailableNovelService,
  replaceOrder: unavailableNovelService,
  replaceStoryUnit: unavailableNovelService,
  deleteParagraph: unavailableNovelService,
}) as unknown as ParagraphService;

const unavailableParagraphQueryService = Object.freeze({
  getCatalog: unavailableNovelService,
  getParagraph: unavailableNovelService,
  listParagraphsByStoryUnit: unavailableNovelService,
}) as unknown as ParagraphQueryService;

const unavailablePublicationService = Object.freeze({
  createPublication: unavailableNovelService,
  createVolume: unavailableNovelService,
  replaceVolume: unavailableNovelService,
  deleteVolume: unavailableNovelService,
  createChapter: unavailableNovelService,
  replaceChapter: unavailableNovelService,
  deleteChapter: unavailableNovelService,
}) as unknown as PublicationService;

const unavailablePublicationQueryService = Object.freeze({
  getCatalog: unavailableNovelService,
  getVolume: unavailableNovelService,
  listVolumes: unavailableNovelService,
  getChapter: unavailableNovelService,
  listChapters: unavailableNovelService,
}) as unknown as PublicationQueryService;

const unavailableLocationToolService = new NovelLocationToolService({
  locations: unavailableLocationService,
  locationQueries: unavailableLocationQueryService,
  drafts: unavailableNovelDraftSessionService,
  identityFactory: {
    createLocationId: () => captureLocationId("unavailable_location"),
  },
});

const unavailableCharacterToolService = new NovelCharacterToolService({
  characters: unavailableCharacterService,
  characterQueries: unavailableCharacterQueryService,
  drafts: unavailableNovelDraftSessionService,
  identityFactory: {
    createCharacterId: () => captureCharacterId("unavailable_character"),
  },
});

const unavailableParagraphToolService = new NovelParagraphToolService({
  paragraphs: unavailableParagraphService,
  paragraphQueries: unavailableParagraphQueryService,
  drafts: unavailableNovelDraftSessionService,
  identityFactory: {
    createParagraphId: () => captureParagraphId("unavailable_paragraph"),
  },
});

const unavailablePublicationToolService = new NovelPublicationToolService({
  publication: unavailablePublicationService,
  publicationQueries: unavailablePublicationQueryService,
  paragraphs: unavailableParagraphQueryService,
  drafts: unavailableNovelDraftSessionService,
  identityFactory: {
    createPublicationStructureId: () =>
      capturePublicationStructureId("unavailable_publication"),
    createPublicationVolumeId: () =>
      capturePublicationVolumeId("unavailable_volume"),
    createPublicationChapterId: () =>
      capturePublicationChapterId("unavailable_chapter"),
  },
});

const unavailableDeleteToolService = new NovelDeleteToolService({
  outline: unavailableStoryOutlineService,
  outlineQueries: unavailableStoryOutlineQueryService,
  characters: unavailableCharacterService,
  characterQueries: unavailableCharacterQueryService,
  locations: unavailableLocationService,
  locationQueries: unavailableLocationQueryService,
  paragraphs: unavailableParagraphService,
  paragraphQueries: unavailableParagraphQueryService,
  publication: unavailablePublicationService,
  publicationQueries: unavailablePublicationQueryService,
  drafts: unavailableNovelDraftSessionService,
});

const unavailableOutlineToolService = new OutlineToolService({
  outline: unavailableStoryOutlineService,
  outlineQueries: unavailableStoryOutlineQueryService,
  drafts: unavailableNovelDraftSessionService,
  identityFactory: {
    createStoryOutlineId: () => captureStoryOutlineId("unavailable_outline"),
    createStoryUnitId: () => captureStoryUnitId("unavailable_story_unit"),
  },
});

export function createNovelConversationManifestComposition(
  options: CreateNovelConversationManifestCompositionOptions = {},
): NovelConversationManifestComposition {
  const digester = new NodeSha256PromptDigester();
  const registry = new ToolRegistry([
    createTodoWriteTool({
      writer: options.todoWriter ?? unavailableTodoWriter,
    }),
    ...createNovelOutlineToolRegistry({
      service: unavailableOutlineToolService,
    }).list(),
    ...createNovelCharacterToolRegistry({
      service: unavailableCharacterToolService,
    }).list(),
    ...createNovelLocationToolRegistry({
      service: unavailableLocationToolService,
    }).list(),
    ...createNovelParagraphToolRegistry({
      service: unavailableParagraphToolService,
    }).list(),
    ...createNovelPublicationToolRegistry({
      service: unavailablePublicationToolService,
    }).list(),
    ...createNovelDeleteToolRegistry({
      service: unavailableDeleteToolService,
    }).list(),
  ]);
  const groups = new ToolGroupCatalog([
    loadToolGroupManifest(NOVEL_CONVERSATION_TOOL_GROUP_MANIFEST),
    NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
    NOVEL_CHARACTER_TOOL_GROUP_MANIFEST,
    NOVEL_LOCATION_TOOL_GROUP_MANIFEST,
    NOVEL_PARAGRAPH_TOOL_GROUP_MANIFEST,
    NOVEL_PUBLICATION_TOOL_GROUP_MANIFEST,
    NOVEL_DELETE_TOOL_GROUP_MANIFEST,
  ]);
  const promptBuilder = new SystemPromptBuilder({
    sections: createDefaultPromptSectionRegistry(),
    digester,
  });
  return Object.freeze({ registry, groups, promptBuilder, digester });
}
