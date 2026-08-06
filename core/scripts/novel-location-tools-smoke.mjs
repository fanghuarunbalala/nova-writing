import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NOVEL_LOCATION_TOOL_GROUP_MANIFEST,
  NovelDraftSessionService,
  NovelLocationToolService,
  captureLocationId,
  captureNovelCommitId,
  captureNovelRevision,
  captureNovelTimestamp,
  createNovelLocationToolRegistry,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelDraftStore,
  SqliteNovelSnapshotter,
  createNodeNovelApplication,
} from "../dist/node/index.js";

class FixedRevisionFactory {
  constructor(value) {
    this.value = captureNovelRevision(value);
  }
  createRevision() {
    return this.value;
  }
}

class SequenceClock {
  offset = 0;
  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 5, 10, 0, 0, this.offset++)).toISOString(),
    );
  }
}

class CollectingLogger {
  constructor(entries = [], bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }
  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }
  child(bindings) {
    return new CollectingLogger(this.entries, { ...this.bindings, ...bindings });
  }
  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-location-tools-"));
const logs = [];
const logger = new CollectingLogger(logs);
let canonicalStore;
let draftStore;

const context = (conversationId, index) => ({
  conversationId,
  runId: `run_${conversationId}_${index}`,
  toolCallId: `call_${conversationId}_${index}`,
  signal: new AbortController().signal,
});
const progress = { async emit() {} };

try {
  const workspaceRoot = join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  canonicalStore = await SqliteNovelCanonicalStore.open({
    location,
    revisionFactory: new FixedRevisionFactory("revision_location_tools_base"),
    logger,
  });
  const canonical = await canonicalStore.getMetadata();
  draftStore = await SqliteNovelDraftStore.open({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const clock = new SequenceClock();
  let draftSequence = 0;
  let locationSequence = 0;
  const drafts = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter: new SqliteNovelSnapshotter({
      location,
      novelId: canonical.novelId,
      logger,
    }),
    identityFactory: {
      createDraftSessionId: () => `draft_location_tools_${++draftSequence}`,
    },
    clock,
    logger,
  });
  const application = createNodeNovelApplication({
    location,
    novelId: canonical.novelId,
    clock,
    logger,
  });
  const service = new NovelLocationToolService({
    locations: application.locations,
    locationQueries: application.locationQueries,
    drafts,
    identityFactory: {
      createLocationId: () =>
        captureLocationId(`location_generated_${++locationSequence}`),
    },
    logger,
  });
  const registry = createNovelLocationToolRegistry({ service, logger });
  assert.deepEqual(
    registry.list().map((tool) => tool.descriptor.name),
    ["NovelLocationEdit", "NovelLocationRead", "NovelLocationWrite"],
  );
  assert.deepEqual(NOVEL_LOCATION_TOOL_GROUP_MANIFEST.tools, [
    "NovelLocationRead",
    "NovelLocationWrite",
    "NovelLocationEdit",
  ]);

  const conversation = "conversation_location_tools";
  const writeTool = registry.require("NovelLocationWrite");
  const readTool = registry.require("NovelLocationRead");
  const editTool = registry.require("NovelLocationEdit");

  const writeResult = await writeTool.handler.execute(
    context(conversation, 1),
    {
      values: [
        { name: "Home", aliases: [], summary: "SMOKE_LOCATION_SUMMARY" },
        {
          id: "location_city",
          name: "City",
          aliases: ["Metropolis"],
          authorNotes: "SMOKE_LOCATION_NOTES",
        },
      ],
    },
    progress,
  );
  assert.deepEqual(
    writeResult.details.items.map((item) => [item.id, item.status]),
    [
      ["location_generated_1", "appended"],
      ["location_city", "appended"],
    ],
  );

  const readResult = await readTool.handler.execute(
    context(conversation, 2),
    { scope: "draft" },
    progress,
  );
  assert.equal(readResult.details.locations.length, 2);
  const city = readResult.details.locations.find(
    (location) => location.id === "location_city",
  );
  assert.equal(city.name, "City");
  assert.deepEqual(city.aliases, ["Metropolis"]);

  const editResult = await editTool.handler.execute(
    context(conversation, 3),
    {
      values: [
        {
          id: "location_city",
          value: {
            summary: "SMOKE_LOCATION_SUMMARY",
            authorNotes: null,
            aliases: [],
          },
        },
      ],
    },
    progress,
  );
  assert.equal(editResult.details.items[0].status, "appended");
  const afterEdit = await readTool.handler.execute(
    context(conversation, 4),
    { scope: "draft", locationId: "location_city" },
    progress,
  );
  assert.equal(afterEdit.details.locations[0].authorNotes, undefined);
  assert.deepEqual(afterEdit.details.locations[0].aliases, []);
  assert.equal(afterEdit.details.locations[0].name, "City");

  const noopEdit = await editTool.handler.execute(
    context(conversation, 5),
    { values: [{ id: "location_city", value: { name: "City" } }] },
    progress,
  );
  assert.equal(noopEdit.details.items[0].status, "duplicate");

  const missingEdit = await editTool.handler.execute(
    context(conversation, 6),
    { values: [{ id: "location_missing", value: { name: "x" } }] },
    progress,
  );
  assert.deepEqual(
    [missingEdit.details.items[0].status, missingEdit.details.items[0].reason],
    ["rejected", "not_found"],
  );

  const duplicateWrite = await writeTool.handler.execute(
    context(conversation, 7),
    { values: [{ id: "location_city", name: "Dup" }] },
    progress,
  );
  assert.deepEqual(
    [duplicateWrite.details.items[0].status, duplicateWrite.details.items[0].reason],
    ["rejected", "duplicate_id"],
  );

  const canonicalBefore = await readTool.handler.execute(
    context(conversation, 8),
    { scope: "canonical" },
    progress,
  );
  assert.equal(canonicalBefore.details.locations.length, 0);

  const session = await drafts.getActiveDraft(conversation);
  await application.commits.commit(session, {
    commitId: captureNovelCommitId("commit_location_tools"),
    resultRevision: captureNovelRevision("revision_location_tools_committed"),
    committedAt: captureNovelTimestamp("2026-08-05T10:30:00.000Z"),
  });
  const canonicalAfter = await readTool.handler.execute(
    context(conversation, 9),
    { scope: "canonical" },
    progress,
  );
  assert.equal(canonicalAfter.details.locations.length, 2);

  const serialized = JSON.stringify(logs);
  for (const forbidden of [
    "SMOKE_LOCATION_SUMMARY",
    "SMOKE_LOCATION_NOTES",
    "Home",
    "City",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }

  console.log("CORE_SMOKE_TEST_RESULT=pass novel-location-tools");
} finally {
  if (draftStore) await draftStore.close();
  if (canonicalStore) await canonicalStore.close();
  await rm(root, { recursive: true, force: true });
}
