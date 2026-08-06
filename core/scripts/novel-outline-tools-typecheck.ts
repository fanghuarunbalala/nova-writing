/** Compile-time contract examples for the Novel Outline Tools. */
import {
  NOVEL_OUTLINE_TOOL_GROUP_MANIFEST,
  NovelOutlineReadParametersSchema,
  OutlineToolService,
  StoryOutlineQueryService,
  StoryOutlineService,
  captureNovelId,
  captureStoryOutlineId,
  captureStoryUnitId,
  captureNovelOperationId,
  type NovelCanonicalWritePort,
  createNovelOutlineEditTool,
  createNovelOutlineReadTool,
  createNovelOutlineToolRegistry,
  createNovelOutlineWriteTool,
} from "../src/index.js";

const service = new OutlineToolService({
  novelId: captureNovelId("novel_typecheck"),
  outlineQueries: undefined as unknown as StoryOutlineQueryService,
  canonicalWrites: undefined as unknown as NovelCanonicalWritePort,
  identityFactory: {
    createStoryOutlineId: () => captureStoryOutlineId("outline_typecheck"),
    createStoryUnitId: () => captureStoryUnitId("story_unit_typecheck"),
    createOperationId: () => captureNovelOperationId("outline_operation_typecheck"),
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
