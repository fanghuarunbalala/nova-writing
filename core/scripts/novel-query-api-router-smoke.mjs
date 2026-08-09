import assert from "node:assert/strict";
import {
  API_PROTOCOL_VERSION,
  NOVEL_QUERY_API_OPERATION,
  NovelQueryApiRouter,
  WorkspaceApiRouter,
} from "../dist/index.js";

async function run() {
const timestamp = "2026-08-04T00:00:00.000Z";
const canonicalScope = { kind: "canonical" };
const draftScope = {
  kind: "conversation-draft",
  conversationId: "conversation-query-router",
};
const rootUnit = {
  id: "story_unit_root",
  outlineId: "outline_main",
  orderKey: "8000",
  title: "第一幕",
  scope: "arc",
  planningStatus: "outlined",
  realizationStatus: "pending",
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
  publication: { id: "publication_main", novelId: "novel_query_router" },
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
const paragraphValue = {
  id: "paragraph_opening",
  storyUnitId: "story_unit_root",
  orderKey: "8000",
  text: "雨落在站台上。",
};
const paragraphDigests = {
  textDigest: "a".repeat(64),
  orderDigest: "c".repeat(64),
  storyUnitDigest: "d".repeat(64),
};
const tree = new TestOutlineTree(rootUnit);
const scopes = [];
const router = new NovelQueryApiRouter({
  workspaceId: "workspace_query_router",
  novelId: "novel_query_router",
  metadata: {
    getMetadata: async () => ({
      workspaceId: "workspace_query_router",
      novelId: "novel_query_router",
      schemaVersion: 10,
      currentRevision: "revision_canonical",
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  },
  drafts: {
    getActiveDraft: async (conversationId) => conversationId === draftScope.conversationId
      ? {
          id: "draft_query_router",
          novelId: "novel_query_router",
          ownerConversationId: conversationId,
          baseRevision: "revision_draft_base",
          status: "active",
          createdAt: timestamp,
          updatedAt: timestamp,
        }
      : undefined,
  },
  characters: {
    list: async (scope) => (scopes.push(scope), [character]),
    get: async (scope, id) => (scopes.push(scope), id === character.id ? character : undefined),
  },
  locations: {
    list: async (scope) => (scopes.push(scope), [location]),
    get: async (scope, id) => (scopes.push(scope), id === location.id ? location : undefined),
  },
  outline: {
    getTree: async (scope) => (scopes.push(scope), tree),
  },
  publication: {
    getCatalog: async (scope) => (scopes.push(scope), { snapshot: publication }),
  },
  paragraphs: {
    getCatalog: async (scope) => (scopes.push(scope), {
      snapshot: {
        paragraphs: [paragraphValue],
      },
      paragraphDigests: { paragraph_opening: paragraphDigests },
    }),
    getParagraph: async (scope, id) => (scopes.push(scope), id === paragraphValue.id
      ? { paragraph: paragraphValue, ...paragraphDigests }
      : undefined),
  },
});

const overview = await request(router, "overview", NOVEL_QUERY_API_OPERATION.overviewGet, {
  scope: draftScope,
});
assert.equal(overview.sourceRevision, "revision_draft_base");
assert.equal(overview.counts.storyUnitCount, 1);
assert.equal(overview.counts.paragraphCount, 1);
assert.equal(overview.roots.paragraphsAvailable, true);

const outline = await request(router, "outline", NOVEL_QUERY_API_OPERATION.outlineGet, {
  scope: canonicalScope,
});
assert.equal(outline.tree.units[0].id, rootUnit.id);
assert.equal(outline.progress[0].storyUnitId, rootUnit.id);

const storyUnit = await request(
  router,
  "story-unit",
  NOVEL_QUERY_API_OPERATION.outlineStoryUnitGet,
  { scope: canonicalScope, storyUnitId: rootUnit.id },
);
assert.equal(storyUnit.unit.title, "第一幕");

const characters = await request(
  router,
  "characters",
  NOVEL_QUERY_API_OPERATION.charactersList,
  { scope: canonicalScope },
);
assert.equal(characters.characters[0].name, "林澈");
const characterDetail = await request(
  router,
  "character",
  NOVEL_QUERY_API_OPERATION.characterGet,
  { scope: canonicalScope, characterId: character.id },
);
assert.equal(characterDetail.character.id, character.id);

const locations = await request(
  router,
  "locations",
  NOVEL_QUERY_API_OPERATION.locationsList,
  { scope: canonicalScope },
);
assert.equal(locations.locations[0].name, "旧车站");
const locationDetail = await request(
  router,
  "location",
  NOVEL_QUERY_API_OPERATION.locationGet,
  { scope: canonicalScope, locationId: location.id },
);
assert.equal(locationDetail.location.id, location.id);

const paragraphCatalog = await request(
  router,
  "paragraph-catalog",
  NOVEL_QUERY_API_OPERATION.paragraphCatalogGet,
  { scope: canonicalScope },
);
assert.equal(paragraphCatalog.paragraphs[0].text, undefined);
assert.equal(paragraphCatalog.paragraphs[0].textLength, paragraphValue.text.length);
const paragraph = await request(
  router,
  "paragraph",
  NOVEL_QUERY_API_OPERATION.paragraphGet,
  { scope: canonicalScope, paragraphId: paragraphValue.id },
);
assert.equal(paragraph.readModel.paragraph.text, paragraphValue.text);
const publicationCatalog = await request(
  router,
  "publication-catalog",
  NOVEL_QUERY_API_OPERATION.publicationCatalogGet,
  { scope: canonicalScope },
);
assert.equal(publicationCatalog.volumes[0].title, "第一卷");
assert.equal(publicationCatalog.chapters[0].volumeId, "volume_one");

const missingDraft = await router.request({
  protocolVersion: API_PROTOCOL_VERSION,
  requestId: "missing-draft",
  operation: NOVEL_QUERY_API_OPERATION.overviewGet,
  payload: {
    scope: { kind: "conversation-draft", conversationId: "missing-conversation" },
  },
});
assert.equal(missingDraft.ok, false);
assert.equal(missingDraft.error.code, "NOVEL_DRAFT_NOT_FOUND");

assert.ok(scopes.some((scope) => scope.kind === "canonical"));
assert.ok(scopes.some((scope) => scope.kind === "draft"));

const conversationTransport = new RecordingTransport();
const workspaceRouter = new WorkspaceApiRouter({
  conversations: conversationTransport,
  novel: router,
});
await request(
  workspaceRouter,
  "workspace-novel",
  NOVEL_QUERY_API_OPERATION.charactersList,
  { scope: canonicalScope },
);
await workspaceRouter.request({
  protocolVersion: API_PROTOCOL_VERSION,
  requestId: "workspace-conversation",
  operation: "conversation.list",
  payload: { options: {} },
});
assert.deepEqual(conversationTransport.operations, ["conversation.list"]);
const subscription = workspaceRouter.subscribe({
  protocolVersion: API_PROTOCOL_VERSION,
  requestId: "workspace-subscribe",
  operation: "conversation.events.subscribe",
  payload: { conversationId: "conversation-query-router", options: {} },
});
assert.equal(subscription.id, "recording-subscription");

console.log("novel query api router smoke passed");

async function request(transport, requestId, operation, payload) {
  const response = await transport.request({
    protocolVersion: API_PROTOCOL_VERSION,
    requestId,
    operation,
    payload,
  });
  assert.equal(response.ok, true, response.ok ? undefined : response.error.code);
  return response.data;
}
}

class TestOutlineTree {
  constructor(unit) {
    this.unit = unit;
  }

  getSnapshot() {
    return {
      outline: { id: "outline_main", novelId: "novel_query_router" },
      units: [this.unit],
    };
  }

  listDepthFirst() {
    return [this.unit];
  }

  getUnit(id) {
    return id === this.unit.id ? this.unit : undefined;
  }

  getProgress(id) {
    return id === this.unit.id
      ? {
          storyUnitId: id,
          effectiveStatus: "pending",
          isBlocked: false,
          isDirectlyBlocked: false,
          isBlockedByAncestor: false,
          blockedLeafCount: 0,
          completedLeafCount: 0,
          totalLeafCount: 1,
        }
      : undefined;
  }
}

class RecordingTransport {
  operations = [];

  async request(request) {
    this.operations.push(request.operation);
    return {
      protocolVersion: API_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      data: {},
    };
  }

  subscribe() {
    return {
      id: "recording-subscription",
      next: async () => ({ done: true, value: undefined }),
      return: async () => ({ done: true, value: undefined }),
      [Symbol.asyncIterator]() { return this; },
      close: async () => undefined,
    };
  }
}

await run();
