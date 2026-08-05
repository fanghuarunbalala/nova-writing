import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NOVEL_ENTITIES_TOOL_GROUP_MANIFEST,
  NovelCharacterToolService,
  NovelDraftSessionService,
  captureCharacterId,
  captureNovelCommitId,
  captureNovelRevision,
  captureNovelTimestamp,
  createNovelCharacterToolRegistry,
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

const root = await mkdtemp(join(tmpdir(), "novel-character-tools-"));
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
    revisionFactory: new FixedRevisionFactory("revision_character_tools_base"),
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
  let characterSequence = 0;
  const drafts = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter: new SqliteNovelSnapshotter({
      location,
      novelId: canonical.novelId,
      logger,
    }),
    identityFactory: {
      createDraftSessionId: () => `draft_character_tools_${++draftSequence}`,
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
  const service = new NovelCharacterToolService({
    characters: application.characters,
    characterQueries: application.characterQueries,
    drafts,
    identityFactory: {
      createCharacterId: () =>
        captureCharacterId(`character_generated_${++characterSequence}`),
    },
    logger,
  });
  const registry = createNovelCharacterToolRegistry({ service, logger });
  assert.deepEqual(
    registry.list().map((tool) => tool.descriptor.name),
    ["NovelCharacterEdit", "NovelCharacterRead", "NovelCharacterWrite"],
  );
  assert.deepEqual(NOVEL_ENTITIES_TOOL_GROUP_MANIFEST.tools, [
    "NovelCharacterRead",
    "NovelCharacterWrite",
    "NovelCharacterEdit",
  ]);

  const conversation = "conversation_character_tools";
  const writeTool = registry.require("NovelCharacterWrite");
  const readTool = registry.require("NovelCharacterRead");
  const editTool = registry.require("NovelCharacterEdit");

  // Write: host-generated id, explicit id, batch order.
  const writeResult = await writeTool.handler.execute(
    context(conversation, 1),
    {
      values: [
        { name: "Protagonist", aliases: [], summary: "SMOKE_SUMMARY" },
        {
          id: "character_hero",
          name: "Hero",
          aliases: ["Alias One"],
          authorNotes: "SMOKE_NOTES",
        },
      ],
    },
    progress,
  );
  assert.deepEqual(
    writeResult.details.items.map((item) => [item.id, item.status]),
    [
      ["character_generated_1", "appended"],
      ["character_hero", "appended"],
    ],
  );

  // Read: draft scope lists both; get one.
  const readResult = await readTool.handler.execute(
    context(conversation, 2),
    { scope: "draft" },
    progress,
  );
  assert.equal(readResult.details.characters.length, 2);
  const hero = readResult.details.characters.find(
    (character) => character.id === "character_hero",
  );
  assert.equal(hero.name, "Hero");
  assert.deepEqual(hero.aliases, ["Alias One"]);
  assert.equal(hero.authorNotes, "SMOKE_NOTES");

  // Edit: partial patch, null clearing, aliases replacement.
  const editResult = await editTool.handler.execute(
    context(conversation, 3),
    {
      values: [
        {
          id: "character_hero",
          value: { summary: "SMOKE_SUMMARY", authorNotes: null, aliases: [] },
        },
      ],
    },
    progress,
  );
  assert.equal(editResult.details.items[0].status, "appended");
  const afterEdit = await readTool.handler.execute(
    context(conversation, 4),
    { scope: "draft", characterId: "character_hero" },
    progress,
  );
  assert.equal(afterEdit.details.characters[0].summary, "SMOKE_SUMMARY");
  assert.equal(afterEdit.details.characters[0].authorNotes, undefined);
  assert.deepEqual(afterEdit.details.characters[0].aliases, []);
  assert.equal(afterEdit.details.characters[0].name, "Hero");

  // Edit: no-op patch returns duplicate.
  const noopEdit = await editTool.handler.execute(
    context(conversation, 5),
    { values: [{ id: "character_hero", value: { name: "Hero" } }] },
    progress,
  );
  assert.equal(noopEdit.details.items[0].status, "duplicate");

  // Edit: missing character rejected; batch stops.
  const missingEdit = await editTool.handler.execute(
    context(conversation, 6),
    {
      values: [
        { id: "character_missing", value: { name: "x" } },
        { id: "character_hero", value: { name: "y" } },
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
    { values: [{ id: "character_hero", name: "Dup" }] },
    progress,
  );
  assert.deepEqual(
    [duplicateWrite.details.items[0].status, duplicateWrite.details.items[0].reason],
    ["rejected", "duplicate_id"],
  );

  // Canonical scope is empty until commit.
  const canonicalBefore = await readTool.handler.execute(
    context(conversation, 8),
    { scope: "canonical" },
    progress,
  );
  assert.equal(canonicalBefore.details.characters.length, 0);

  const session = await drafts.getActiveDraft(conversation);
  await application.commits.commit(session, {
    commitId: captureNovelCommitId("commit_character_tools"),
    resultRevision: captureNovelRevision("revision_character_tools_committed"),
    committedAt: captureNovelTimestamp("2026-08-05T10:30:00.000Z"),
  });
  const canonicalAfter = await readTool.handler.execute(
    context(conversation, 9),
    { scope: "canonical" },
    progress,
  );
  assert.equal(canonicalAfter.details.characters.length, 2);

  // Redaction: no profile content in structured logs.
  const serialized = JSON.stringify(logs);
  for (const forbidden of ["SMOKE_SUMMARY", "SMOKE_NOTES", "Protagonist", "Hero"]) {
    assert.equal(serialized.includes(forbidden), false);
  }

  console.log("CORE_SMOKE_TEST_RESULT=pass novel-character-tools");
} finally {
  if (draftStore) await draftStore.close();
  if (canonicalStore) await canonicalStore.close();
  await rm(root, { recursive: true, force: true });
}
