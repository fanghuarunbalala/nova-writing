import assert from "node:assert/strict";
import {
  API_PROTOCOL_VERSION,
  ApiRemoteError,
  DefaultNovelApiClient,
  NOVEL_QUERY_API_OPERATION,
  NovelQueryClientProtocolError,
  canonicalNovelQueryScope,
} from "../dist/index.js";

const timestamp = "2026-08-04T00:00:00.000Z";

async function run() {
const transport = new NovelQueryClientTransport();
const api = new DefaultNovelApiClient({
  transport,
  requestIdFactory: createRequestIdFactory(),
});

assert.equal(
  (await api.novel.overview.get(canonicalNovelQueryScope)).workspaceId,
  "workspace_query_client",
);
assert.equal(
  (await api.novel.outline.get(canonicalNovelQueryScope)).tree.units.length,
  1,
);
assert.equal(
  (
    await api.novel.outline.getStoryUnit(
      canonicalNovelQueryScope,
      "story_unit_root",
    )
  ).unit.id,
  "story_unit_root",
);
assert.equal(
  (await api.novel.characters.list(canonicalNovelQueryScope)).characters[0].id,
  "character_primary",
);
assert.equal(
  (
    await api.novel.characters.get(
      canonicalNovelQueryScope,
      "character_primary",
    )
  ).character.name,
  "林澈",
);
assert.equal(
  (await api.novel.locations.list(canonicalNovelQueryScope)).locations[0].id,
  "location_station",
);
assert.equal(
  (
    await api.novel.locations.get(
      canonicalNovelQueryScope,
      "location_station",
    )
  ).location.name,
  "旧车站",
);
assert.equal(
  (
    await api.novel.paragraphs.getCatalog(canonicalNovelQueryScope)
  ).paragraphs[0].textLength,
  7,
);
assert.equal(
  (
    await api.novel.paragraphs.get(
      canonicalNovelQueryScope,
      "paragraph_opening",
    )
  ).readModel.paragraph.text,
  "雨落在站台上。",
);
assert.equal(
  (await api.novel.publication.getCatalog(canonicalNovelQueryScope)).volumes[0]
    .title,
  "第一卷",
);

assert.deepEqual(
  transport.requests.map((request) => request.operation),
  Object.values(NOVEL_QUERY_API_OPERATION),
);
assert.ok(
  transport.requests.every(
    (request) => request.payload.scope.kind === "canonical",
  ),
);

transport.failure = {
  protocolVersion: API_PROTOCOL_VERSION,
  requestId: "dynamic",
  ok: false,
  error: {
    code: "NOVEL_DRAFT_NOT_FOUND",
    category: "not-found",
    retryable: false,
    message: "Conversation Draft was not found",
  },
};
await assert.rejects(
  api.novel.overview.get({
    kind: "conversation-draft",
    conversationId: "missing-conversation",
  }),
  (error) =>
    error instanceof ApiRemoteError &&
    error.code === "NOVEL_DRAFT_NOT_FOUND" &&
    error.category === "not-found",
);

transport.failure = {
  protocolVersion: API_PROTOCOL_VERSION,
  requestId: "mismatched-request",
  ok: true,
  data: {},
};
await assert.rejects(
  api.novel.overview.get(canonicalNovelQueryScope),
  NovelQueryClientProtocolError,
);

console.log("novel query client smoke passed");
}

class NovelQueryClientTransport {
  requests = [];
  failure = undefined;

  async request(request) {
    this.requests.push(request);
    if (this.failure !== undefined) {
      const failure = this.failure;
      this.failure = undefined;
      return failure.requestId === "dynamic"
        ? { ...failure, requestId: request.requestId }
        : failure;
    }
    return {
      protocolVersion: API_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      data: responseData(request.operation),
    };
  }

  subscribe() {
    throw new Error("not used");
  }
}

function responseData(operation) {
  const scope = canonicalNovelQueryScope;
  const unit = {
    id: "story_unit_root",
    outlineId: "outline_main",
    orderKey: "8000",
    title: "第一幕",
    scope: "arc",
    planningStatus: "ready",
    realizationStatus: "pending",
  };
  const progress = {
    storyUnitId: unit.id,
    effectiveStatus: "pending",
    isBlocked: false,
    isDirectlyBlocked: false,
    isBlockedByAncestor: false,
    blockedLeafCount: 0,
    completedLeafCount: 0,
    totalLeafCount: 1,
  };
  const character = {
    id: "character_primary",
    name: "林澈",
    aliases: [],
    summary: "主角",
    entityVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const location = {
    id: "location_station",
    name: "旧车站",
    aliases: [],
    initialState: "废弃",
    entityVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const publication = {
    publication: { id: "publication_main", novelId: "novel_query_client" },
    volumes: [{
      id: "volume_one",
      publicationId: "publication_main",
      orderKey: "8000",
      title: "第一卷",
    }],
    chapters: [{
      id: "chapter_one",
      publicationId: "publication_main",
      volumeId: "volume_one",
      orderKey: "8000",
      title: "雨夜",
      paragraphIds: ["paragraph_opening"],
    }],
  };
  const paragraph = {
    id: "paragraph_opening",
    storyUnitId: unit.id,
    orderKey: "8000",
    text: "雨落在站台上。",
  };
  const base = { schemaVersion: 1, scope };
  switch (operation) {
    case NOVEL_QUERY_API_OPERATION.overviewGet:
      return {
        ...base,
        workspaceId: "workspace_query_client",
        novelId: "novel_query_client",
        novelSchemaVersion: 10,
        sourceRevision: "revision_query_client",
        counts: {
          storyUnitCount: 1,
          characterCount: 1,
          locationCount: 1,
          volumeCount: 1,
          chapterCount: 1,
          paragraphCount: 1,
        },
        roots: {
          outlineAvailable: true,
          publicationAvailable: true,
          paragraphsAvailable: true,
        },
      };
    case NOVEL_QUERY_API_OPERATION.outlineGet:
      return {
        ...base,
        tree: {
          outline: { id: "outline_main", novelId: "novel_query_client" },
          units: [unit],
        },
        progress: [progress],
      };
    case NOVEL_QUERY_API_OPERATION.outlineStoryUnitGet:
      return { ...base, unit, progress };
    case NOVEL_QUERY_API_OPERATION.charactersList:
      return { ...base, characters: [character] };
    case NOVEL_QUERY_API_OPERATION.characterGet:
      return { ...base, character };
    case NOVEL_QUERY_API_OPERATION.locationsList:
      return { ...base, locations: [location] };
    case NOVEL_QUERY_API_OPERATION.locationGet:
      return { ...base, location };
    case NOVEL_QUERY_API_OPERATION.paragraphCatalogGet:
      return {
        ...base,
        paragraphs: [{
          id: paragraph.id,
          storyUnitId: paragraph.storyUnitId,
          orderKey: paragraph.orderKey,
          textLength: paragraph.text.length,
          textDigest: "a".repeat(64),
        }],
      };
    case NOVEL_QUERY_API_OPERATION.paragraphGet:
      return {
        ...base,
        readModel: {
          paragraph,
          textDigest: "a".repeat(64),
          orderDigest: "c".repeat(64),
          storyUnitDigest: "d".repeat(64),
        },
      };
    case NOVEL_QUERY_API_OPERATION.publicationCatalogGet:
      return { ...base, volumes: publication.volumes, chapters: publication.chapters };
    default:
      throw new Error("unexpected operation");
  }
}

function createRequestIdFactory() {
  let value = 0;
  return () => `novel-query-client-${++value}`;
}

await run();
