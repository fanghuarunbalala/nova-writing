/** Compile-time contract examples for the Novel Location Tools. */
import {
  NOVEL_LOCATION_TOOL_GROUP_MANIFEST,
  LocationQueryService,
  LocationService,
  NovelLocationToolService,
  captureLocationId,
  captureNovelOperationId,
  type NovelCanonicalWritePort,
  createNovelLocationEditTool,
  createNovelLocationReadTool,
  createNovelLocationToolRegistry,
  createNovelLocationWriteTool,
} from "../src/index.js";

const service = new NovelLocationToolService({
  locationQueries: undefined as unknown as LocationQueryService,
  canonicalWrites: undefined as unknown as NovelCanonicalWritePort,
  identityFactory: {
    createLocationId: () => captureLocationId("location_typecheck"),
    createOperationId: () => captureNovelOperationId("location_operation_typecheck"),
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
