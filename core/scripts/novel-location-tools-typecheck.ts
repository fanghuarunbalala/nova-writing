/** Compile-time contract examples for the Novel Location Tools. */
import {
  NOVEL_LOCATION_TOOL_GROUP_MANIFEST,
  LocationQueryService,
  LocationService,
  NovelDraftSessionService,
  NovelLocationToolService,
  captureLocationId,
  createNovelLocationEditTool,
  createNovelLocationReadTool,
  createNovelLocationToolRegistry,
  createNovelLocationWriteTool,
} from "../src/index.js";

const service = new NovelLocationToolService({
  locations: undefined as unknown as LocationService,
  locationQueries: undefined as unknown as LocationQueryService,
  drafts: undefined as unknown as NovelDraftSessionService,
  identityFactory: {
    createLocationId: () => captureLocationId("location_typecheck"),
  },
});

const readTool = createNovelLocationReadTool({ service });
const writeTool = createNovelLocationWriteTool({ service });
const editTool = createNovelLocationEditTool({ service });
const registry = createNovelLocationToolRegistry({ service });

void readTool.descriptor.parameters;
void writeTool.descriptor.parameters;
void editTool.descriptor.parameters;
void registry.require("NovelLocationRead").handler;
void registry.require("NovelLocationWrite").handler;
void registry.require("NovelLocationEdit").handler;
void NOVEL_LOCATION_TOOL_GROUP_MANIFEST.tools;
