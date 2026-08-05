/** Compile-time contract examples for the Novel Outline Tools. */
import {
  NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
  NovelDraftSessionService,
  NovelOutlineReadParametersSchema,
  OutlineToolService,
  StoryOutlineQueryService,
  StoryOutlineService,
  captureStoryOutlineId,
  createNovelOutlineEditTool,
  createNovelOutlineReadTool,
  createNovelOutlineToolRegistry,
  createNovelOutlineWriteTool,
} from "../src/index.js";

const service = new OutlineToolService({
  outline: undefined as unknown as StoryOutlineService,
  outlineQueries: undefined as unknown as StoryOutlineQueryService,
  drafts: undefined as unknown as NovelDraftSessionService,
  identityFactory: {
    createStoryOutlineId: () => captureStoryOutlineId("outline_typecheck"),
  },
});

const readTool = createNovelOutlineReadTool({ service });
const writeTool = createNovelOutlineWriteTool({ service });
const editTool = createNovelOutlineEditTool({ service });
const registry = createNovelOutlineToolRegistry({ service });

void readTool.descriptor.parameters;
void writeTool.descriptor.parameters;
void editTool.descriptor.parameters;
void registry.require("NovelOutlineRead").handler;
void registry.require("NovelOutlineWrite").handler;
void registry.require("NovelOutlineEdit").handler;
void NovelOutlineReadParametersSchema;
void NOVEL_OUTLINE_TOOL_GROUP_MANIFEST.tools;
