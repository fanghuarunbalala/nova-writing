import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NOVEL_LOCATION_TOOL_GROUP_MANIFEST,
  NovelLocationToolService,
  captureLocationId,
  captureNovelOperationId,
  captureNovelRevision,
  captureNovelTimestamp,
  createNovelLocationToolRegistry,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
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
  const canonicalStore = await SqliteNovelCanonicalStore.open({
    location,
    revisionFactory: new FixedRevisionFactory("revision_location_tools_base"),
    logger,
  });
  const canonical = await canonicalStore.getMetadata();
  const clock = new SequenceClock();
  let locationSequence = 0;
  let operationSequence = 0;
  const application = createNodeNovelApplication({
    location,
    novelId: canonical.novelId,
    clock,
    logger,
  });
  const service = new NovelLocationToolService({
    locationQueries: application.locationQueries,
    canonicalWrites: application.canonicalWrites,
    identityFactory: {
      createLocationId: () =>
        captureLocationId(`location_generated_${++locationSequence}`),
      createOperationId: () =>
        captureNovelOperationId(`location_tool_operation_${++operationSequence}`),
    },
    clock,
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

  // Write: host-generated id, explicit id, batch order.
  const writeResult = await writeTool.handler.execute(
    context(conversation, 1),
    {
      baseRevision: await application.canonicalWrites.getCurrentRevision(),
      values: [
        { name: "Kingdom", aliases: [], summary: "SMOKE_SUMMARY" },
        {
          id: "location_city",
          name: "City",
          aliases: ["Capital"],
          authorNotes: "SMOKE_NOTES",
        },
      ],
    },
    progress,
  );
  assert.deepEqual(
    writeResult.details.items.map((item) => [item.id, item.status]),
    [
      ["location_generated_1", "applied"],
      ["location_city", "applied"],
    ],
  );
  const writeRevision = writeResult.details.revision.currentRevision;
  assert.notEqual(writeRevision, "revision_location_tools_base");

  // Read: lists both; get one; revision matches write.
  const readResult = await readTool.handler.execute(
    context(conversation, 2),
    {},
    progress,
  );
  assert.equal(readResult.details.locations.length, 2);
  // content carries real data (provider serializes content only in the live turn).
  assert.match(readResult.content[0].text, /^Locations read\.\n\{/);
  assert.match(readResult.content[0].text, /"location_city"/);
  const city = readResult.details.locations.find(
    (entry) => entry.id === "location_city",
  );
  assert.equal(city.name, "City");
  assert.deepEqual(city.aliases, ["Capital"]);
  assert.equal(city.authorNotes, "SMOKE_NOTES");
  assert.equal(readResult.details.revision.currentRevision, writeRevision);

  // Edit: partial patch, null clearing, aliases replacement.
  const editResult = await editTool.handler.execute(
    context(conversation, 3),
    {
      baseRevision: writeRevision,
      values: [
        {
          id: "location_city",
          value: { summary: "SMOKE_SUMMARY", authorNotes: null, aliases: [] },
        },
      ],
    },
    progress,
  );
  assert.equal(editResult.details.items[0].status, "applied");
  const afterEdit = await readTool.handler.execute(
    context(conversation, 4),
    { locationId: "location_city" },
    progress,
  );
  assert.equal(afterEdit.details.locations[0].summary, "SMOKE_SUMMARY");
  assert.equal(afterEdit.details.locations[0].authorNotes, undefined);
  assert.deepEqual(afterEdit.details.locations[0].aliases, []);
  assert.equal(afterEdit.details.locations[0].name, "City");

  // Edit: no-op patch applies as a no-change success.
  const noopEdit = await editTool.handler.execute(
    context(conversation, 5),
    {
      baseRevision: afterEdit.details.revision.currentRevision,
      values: [{ id: "location_city", value: { name: "City" } }],
    },
    progress,
  );
  assert.equal(noopEdit.details.items[0].status, "applied");

  // Edit: missing location rejected; whole batch left unapplied.
  const missingEdit = await editTool.handler.execute(
    context(conversation, 6),
    {
      baseRevision: afterEdit.details.revision.currentRevision,
      values: [
        { id: "location_missing", value: { name: "x" } },
        { id: "location_city", value: { name: "y" } },
      ],
    },
    progress,
  );
  assert.deepEqual(
    [missingEdit.details.items[0].status, missingEdit.details.items[0].reason],
    ["rejected", "not_found"],
  );
  assert.equal(missingEdit.details.items.length, 1);

  // Write: duplicate id rejected.
  const duplicateWrite = await writeTool.handler.execute(
    context(conversation, 7),
    {
      baseRevision: afterEdit.details.revision.currentRevision,
      values: [{ id: "location_city", name: "Dup" }],
    },
    progress,
  );
  assert.deepEqual(
    [
      duplicateWrite.details.items[0].status,
      duplicateWrite.details.items[0].reason,
    ],
    ["rejected", "duplicate_id"],
  );

  // 全局 baseRevision 不再作冲突判定：旧 baseRevision 创建新地点仍成功。
  const staleCreate = await writeTool.handler.execute(
    context(conversation, 8),
    {
      baseRevision: writeRevision,
      values: [{ name: "Stale", aliases: [] }],
    },
    progress,
  );
  assert.equal(staleCreate.details.items[0].status, "applied");

  // Redaction: no profile content in structured logs.
  const serialized = JSON.stringify(logs);
  for (const forbidden of [
    "SMOKE_SUMMARY",
    "SMOKE_NOTES",
    "Kingdom",
    "City",
    root,
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }

  console.log("CORE_SMOKE_TEST_RESULT=pass novel-location-tools");
} finally {
  await rm(root, { recursive: true, force: true });
}
