/** Production assembly dependencies for the default Novel Conversation Agent. */
import {
  SystemPromptBuilder,
  createDefaultPromptSectionRegistry,
  type PromptDigester,
} from "../../../prompt/index.js";
import {
  type CharacterQueryService,
  type CharacterService,
  type NovelDraftSessionService,
  type StoryOutlineQueryService,
  type StoryOutlineService,
  captureCharacterId,
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

const unavailableCharacterToolService = new NovelCharacterToolService({
  characters: unavailableCharacterService,
  characterQueries: unavailableCharacterQueryService,
  drafts: unavailableNovelDraftSessionService,
  identityFactory: {
    createCharacterId: () => captureCharacterId("unavailable_character"),
  },
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
  ]);
  const groups = new ToolGroupCatalog([
    loadToolGroupManifest(NOVEL_CONVERSATION_TOOL_GROUP_MANIFEST),
    NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
    NOVEL_CHARACTER_TOOL_GROUP_MANIFEST,
  ]);
  const promptBuilder = new SystemPromptBuilder({
    sections: createDefaultPromptSectionRegistry(),
    digester,
  });
  return Object.freeze({ registry, groups, promptBuilder, digester });
}
