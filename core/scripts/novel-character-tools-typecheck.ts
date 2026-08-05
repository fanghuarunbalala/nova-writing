/** Compile-time contract examples for the Novel Character Tools. */
import {
  NOVEL_ENTITIES_TOOL_GROUP_MANIFEST,
  CharacterQueryService,
  CharacterService,
  NovelCharacterToolService,
  NovelDraftSessionService,
  captureCharacterId,
  createNovelCharacterEditTool,
  createNovelCharacterReadTool,
  createNovelCharacterToolRegistry,
  createNovelCharacterWriteTool,
} from "../src/index.js";

const service = new NovelCharacterToolService({
  characters: undefined as unknown as CharacterService,
  characterQueries: undefined as unknown as CharacterQueryService,
  drafts: undefined as unknown as NovelDraftSessionService,
  identityFactory: {
    createCharacterId: () => captureCharacterId("character_typecheck"),
  },
});

const readTool = createNovelCharacterReadTool({ service });
const writeTool = createNovelCharacterWriteTool({ service });
const editTool = createNovelCharacterEditTool({ service });
const registry = createNovelCharacterToolRegistry({ service });

void readTool.descriptor.parameters;
void writeTool.descriptor.parameters;
void editTool.descriptor.parameters;
void registry.require("NovelCharacterRead").handler;
void registry.require("NovelCharacterWrite").handler;
void registry.require("NovelCharacterEdit").handler;
void NOVEL_ENTITIES_TOOL_GROUP_MANIFEST.tools;
