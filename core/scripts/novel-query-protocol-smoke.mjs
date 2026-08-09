import assert from "node:assert/strict";
import {
  NOVEL_QUERY_API_OPERATION,
  NOVEL_QUERY_SCOPE_KIND,
  NOVEL_QUERY_SNAPSHOT_VERSION,
  canonicalNovelQueryScope,
  captureNovelCharacterQueryRequest,
  captureNovelCharactersSnapshot,
  captureNovelLocationSnapshot,
  captureNovelOutlineSnapshot,
  captureNovelOverviewSnapshot,
  captureNovelParagraphCatalogSnapshot,
  captureNovelParagraphQueryRequest,
  captureNovelParagraphSnapshot,
  captureNovelPublicationCatalogSnapshot,
  captureNovelQueryScope,
  captureNovelScopedQueryRequest,
  captureNovelStoryUnitQueryRequest,
  captureNovelStoryUnitSnapshot,
} from "../dist/index.js";

const canonicalScope = canonicalNovelQueryScope;
const draftScope = captureNovelQueryScope({
  kind: NOVEL_QUERY_SCOPE_KIND.conversationDraft,
  conversationId: "conversation_query_protocol",
});

assert.deepEqual(Object.values(NOVEL_QUERY_API_OPERATION), [
  "novel.overview.get",
  "novel.outline.get",
  "novel.outline.storyUnit.get",
  "novel.characters.list",
  "novel.characters.get",
  "novel.locations.list",
  "novel.locations.get",
  "novel.paragraph.catalog.get",
  "novel.paragraph.get",
  "novel.publication.catalog.get",
]);
assert.equal(captureNovelQueryScope(canonicalScope), canonicalScope);
assert.deepEqual(captureNovelScopedQueryRequest({ scope: draftScope }), {
  scope: draftScope,
});
assert.equal(
  captureNovelStoryUnitQueryRequest({
    scope: canonicalScope,
    storyUnitId: "story_unit_root",
  }).storyUnitId,
  "story_unit_root",
);
assert.equal(
  captureNovelCharacterQueryRequest({
    scope: canonicalScope,
    characterId: "character_primary",
  }).characterId,
  "character_primary",
);
assert.equal(
  captureNovelParagraphQueryRequest({
    scope: canonicalScope,
    paragraphId: "paragraph_opening",
  }).paragraphId,
  "paragraph_opening",
);

const rootUnit = {
  id: "story_unit_root",
  outlineId: "outline_main",
  orderKey: "8000",
  title: "第一幕",
  scope: "arc",
  planningStatus: "ready",
  realizationStatus: "in-progress",
};
const childUnit = {
  id: "story_unit_child",
  outlineId: "outline_main",
  parentId: "story_unit_root",
  orderKey: "8000",
  title: "雨夜相遇",
  scope: "scene",
  planningStatus: "outlined",
  realizationStatus: "pending",
};
const progress = [
  {
    storyUnitId: "story_unit_root",
    effectiveStatus: "pending",
    isBlocked: false,
    isDirectlyBlocked: false,
    isBlockedByAncestor: false,
    blockedLeafCount: 0,
    completedLeafCount: 0,
    totalLeafCount: 1,
  },
  {
    storyUnitId: "story_unit_child",
    effectiveStatus: "pending",
    isBlocked: false,
    isDirectlyBlocked: false,
    isBlockedByAncestor: false,
    blockedLeafCount: 0,
    completedLeafCount: 0,
    totalLeafCount: 1,
  },
];
const outline = captureNovelOutlineSnapshot(jsonRoundTrip({
  schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
  scope: canonicalScope,
  tree: {
    outline: { id: "outline_main", novelId: "novel_query_protocol" },
    units: [rootUnit, childUnit],
  },
  progress,
}));
assert.equal(outline.tree.units.length, 2);
assert.equal(Object.isFrozen(outline.progress), true);

const storyUnit = captureNovelStoryUnitSnapshot(jsonRoundTrip({
  schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
  scope: canonicalScope,
  unit: childUnit,
  progress: progress[1],
}));
assert.equal(storyUnit.unit.id, "story_unit_child");

const timestamp = "2026-08-04T00:00:00.000Z";
const character = {
  id: "character_primary",
  name: "林澈",
  aliases: ["小林"],
  summary: "主角",
  entityVersion: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const characters = captureNovelCharactersSnapshot(jsonRoundTrip({
  schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
  scope: draftScope,
  characters: [character],
}));
assert.equal(characters.characters[0].name, "林澈");

const location = captureNovelLocationSnapshot(jsonRoundTrip({
  schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
  scope: canonicalScope,
  location: {
    id: "location_station",
    name: "旧车站",
    aliases: [],
    initialState: "废弃",
    entityVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
}));
assert.equal(location.location.name, "旧车站");

const digest = "a".repeat(64);
const publication = {
  publication: {
    id: "publication_main",
    novelId: "novel_query_protocol",
  },
  volumes: [
    {
      id: "volume_one",
      publicationId: "publication_main",
      orderKey: "8000",
      title: "第一卷",
      primaryStoryUnitId: "story_unit_root",
    },
  ],
  chapters: [
    {
      id: "chapter_one",
      publicationId: "publication_main",
      volumeId: "volume_one",
      orderKey: "8000",
      title: "雨夜",
      paragraphIds: ["paragraph_opening"],
    },
  ],
};
const paragraphCatalog = captureNovelParagraphCatalogSnapshot(jsonRoundTrip({
  schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
  scope: canonicalScope,
  paragraphs: [
    {
      id: "paragraph_opening",
      storyUnitId: "story_unit_root",
      orderKey: "8000",
      textLength: 12,
      textDigest: digest,
    },
  ],
}));
assert.equal(paragraphCatalog.paragraphs[0].textLength, 12);

const paragraphSnapshot = captureNovelParagraphSnapshot(jsonRoundTrip({
  schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
  scope: canonicalScope,
  readModel: {
    paragraph: {
      id: "paragraph_opening",
      storyUnitId: "story_unit_root",
      orderKey: "8000",
      text: "雨落在站台上。",
    },
    textDigest: digest,
    orderDigest: "c".repeat(64),
    storyUnitDigest: "d".repeat(64),
  },
}));
assert.equal(paragraphSnapshot.readModel.paragraph.text, "雨落在站台上。");

const publicationCatalog = captureNovelPublicationCatalogSnapshot(jsonRoundTrip({
  schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
  scope: canonicalScope,
  volumes: [
    {
      id: "volume_one",
      publicationId: "publication_main",
      orderKey: "8000",
      title: "第一卷",
    },
  ],
  chapters: [
    {
      id: "chapter_one",
      publicationId: "publication_main",
      volumeId: "volume_one",
      orderKey: "8000",
      title: "雨夜",
      paragraphIds: ["paragraph_opening"],
    },
  ],
}));
assert.equal(publicationCatalog.volumes[0].title, "第一卷");
assert.deepEqual(publicationCatalog.chapters[0].paragraphIds, [
  "paragraph_opening",
]);
assert.throws(
  () => captureNovelPublicationCatalogSnapshot({
    schemaVersion: 1,
    scope: canonicalScope,
    volumes: [
      {
        id: "volume_one",
        publicationId: "publication_main",
        orderKey: "8000",
        title: "第一卷",
      },
    ],
    chapters: [
      {
        id: "chapter_one",
        publicationId: "publication_main",
        volumeId: "volume_unknown",
        orderKey: "8000",
        title: "雨夜",
        paragraphIds: [],
      },
    ],
  }),
  /snapshot is invalid/u,
);

const overview = captureNovelOverviewSnapshot(jsonRoundTrip({
  schemaVersion: NOVEL_QUERY_SNAPSHOT_VERSION,
  scope: canonicalScope,
  workspaceId: "workspace_query_protocol",
  novelId: "novel_query_protocol",
  novelSchemaVersion: 10,
  sourceRevision: "revision_query_protocol",
  counts: {
    storyUnitCount: 2,
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
}));
assert.equal(overview.counts.storyUnitCount, 2);

assert.throws(
  () => captureNovelQueryScope({ kind: "canonical", conversationId: "extra" }),
  /request is invalid/u,
);
assert.throws(
  () => captureNovelCharactersSnapshot({
    schemaVersion: 1,
    scope: canonicalScope,
    characters: [character, character],
  }),
  /snapshot is invalid/u,
);
assert.throws(
  () => captureNovelParagraphCatalogSnapshot({
    schemaVersion: 1,
    scope: canonicalScope,
    paragraphs: [
      {
        id: "paragraph_opening",
        storyUnitId: "story_unit_root",
        orderKey: "8000",
        textLength: 12,
        textDigest: digest,
      },
      {
        id: "paragraph_opening",
        storyUnitId: "story_unit_root",
        orderKey: "8000",
        textLength: 12,
        textDigest: digest,
      },
    ],
  }),
  /snapshot is invalid/u,
);
assert.throws(
  () => captureNovelOutlineSnapshot({
    schemaVersion: 1,
    scope: canonicalScope,
    progress,
  }),
  /snapshot is invalid/u,
);

console.log("novel query protocol smoke passed");

function jsonRoundTrip(value) {
  return JSON.parse(JSON.stringify(value));
}
