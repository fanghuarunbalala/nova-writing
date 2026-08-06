/** Compile-time contract examples for the Novel Character Tools. */
import {
  NOVEL_CHARACTER_TOOL_GROUP_MANIFEST,
  CharacterQueryService,
  CharacterService,
  NovelCharacterToolService,
  captureCharacterId,
  captureNovelOperationId,
  type NovelCanonicalWritePort,
  createNovelCharacterEditTool,
  createNovelCharacterReadTool,
  createNovelCharacterToolRegistry,
  createNovelCharacterWriteTool,
} from "../src/index.js";

const service = new NovelCharacterToolService({
  characterQueries: undefined as unknown as CharacterQueryService,
  canonicalWrites: undefined as unknown as NovelCanonicalWritePort,
  identityFactory: {
    createCharacterId: () => captureCharacterId("character_typecheck"),
    createOperationId: () => captureNovelOperationId("character_operation_typecheck"),
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
void NOVEL_CHARACTER_TOOL_GROUP_MANIFEST.tools;
