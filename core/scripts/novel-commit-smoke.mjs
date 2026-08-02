import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NovelDraftSessionService,
  NovelCommitHistoryIntegrityError,
  NovelInvariantViolationError,
  NOVEL_INVARIANT_FAILURE,
  NovelRevisionConflictError,
  canonicalNovelReadScope,
  captureCharacterId,
  captureLocationId,
  captureNovelCommitId,
  captureNovelOperationId,
  captureNovelRevision,
  captureNovelTimestamp,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelDraftStore,
  SqliteNovelSnapshotter,
  createNodeNovelEntityApplication,
} from "../dist/node/index.js";

class DraftIdentityFactory {
  constructor() { this.sequence = 0; }
  createDraftSessionId() {
    this.sequence += 1;
    return `draft_commit_${this.sequence}`;
  }
}

class OperationIdentityFactory {
  constructor() { this.sequence = 0; }
  createOperationId() {
    this.sequence += 1;
    return captureNovelOperationId(`commit_operation_${this.sequence}`);
  }
}

class FixedRevisionFactory {
  constructor(value) { this.value = captureNovelRevision(value); }
  createRevision() { return this.value; }
}

class SequenceClock {
  constructor() { this.offset = 0; }
  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 2, 11, 0, 0, this.offset++)).toISOString(),
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

function inspectCanonical(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return {
      metadata: database
        .prepare("SELECT current_revision FROM novel_metadata WHERE singleton = 1")
        .get(),
      commits: database.prepare("SELECT * FROM novel_commits ORDER BY committed_at").all(),
      outbox: database.prepare("SELECT event_json FROM novel_outbox ORDER BY created_at").all(),
    };
  } finally {
    database.close();
  }
}

function assertRedacted(entries, forbidden) {
  const serialized = JSON.stringify(entries);
  for (const value of forbidden) assert.equal(serialized.includes(value), false);
  for (const entry of entries) {
    for (const key of Object.keys(entry.fields)) {
      assert.equal(["payload", "content", "text", "path", "message", "stack", "cause"].includes(key), false);
    }
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-commit-"));
const workspaceRoot = join(root, "workspace");
const logs = [];
const logger = new CollectingLogger(logs);
let canonicalStore;
let draftStore;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  canonicalStore = await SqliteNovelCanonicalStore.open({
    location,
    revisionFactory: new FixedRevisionFactory("revision_commit_base"),
    logger,
  });
  const canonical = await canonicalStore.getMetadata();
  draftStore = await SqliteNovelDraftStore.open({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const clock = new SequenceClock();
  const drafts = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter: new SqliteNovelSnapshotter({
      location,
      novelId: canonical.novelId,
      logger,
    }),
    identityFactory: new DraftIdentityFactory(),
    clock,
    logger,
  });
  const sessionA = await drafts.startDraft("conversation-commit-a");
  const sessionB = await drafts.startDraft("conversation-commit-b");
  const application = createNodeNovelEntityApplication({
    location,
    novelId: canonical.novelId,
    identityFactory: new OperationIdentityFactory(),
    clock,
    logger,
  });
  const secretCharacter = "FORBIDDEN_COMMITTED_CHARACTER";
  const secretLocation = "FORBIDDEN_STALE_LOCATION";
  const characterId = captureCharacterId("character_committed");
  const locationId = captureLocationId("location_stale");
  await application.characters.create(sessionA, characterId, {
    name: secretCharacter,
    aliases: [],
  });
  await application.locations.create(sessionB, locationId, {
    name: secretLocation,
    aliases: [],
  });
  assert.equal(await application.characterQueries.get(canonicalNovelReadScope, characterId), undefined);

  const failingApplication = createNodeNovelEntityApplication({
    location,
    novelId: canonical.novelId,
    identityFactory: new OperationIdentityFactory(),
    clock,
    logger,
    validateCommit() {
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.persistenceInvariant,
        canonical.novelId,
        sessionA.id,
      );
    },
  });
  await assert.rejects(
    failingApplication.commits.commit(sessionA, {
      commitId: captureNovelCommitId("commit_failed"),
      resultRevision: captureNovelRevision("revision_commit_failed"),
      committedAt: captureNovelTimestamp("2026-08-02T11:29:00.000Z"),
    }),
    (error) => error instanceof NovelInvariantViolationError,
  );
  const rolledBack = inspectCanonical(location.canonicalDatabasePath);
  assert.equal(rolledBack.metadata.current_revision, "revision_commit_base");
  assert.equal(rolledBack.commits.length, 0);
  assert.equal(rolledBack.outbox.length, 0);
  assert.equal(await application.characterQueries.get(canonicalNovelReadScope, characterId), undefined);

  const commitIdA = captureNovelCommitId("commit_a");
  const resultRevisionA = captureNovelRevision("revision_commit_a");
  const committedAtA = captureNovelTimestamp("2026-08-02T11:30:00.000Z");
  const committed = await application.commits.commit(sessionA, {
    commitId: commitIdA,
    resultRevision: resultRevisionA,
    committedAt: committedAtA,
  });
  await assert.rejects(access(join(location.commitHistoryDir, "commit_failed.json")));
  assert.equal(committed.status, "committed");
  assert.equal(committed.commit.resultRevision, resultRevisionA);
  assert.equal(
    (await application.characterQueries.get(canonicalNovelReadScope, characterId)).name,
    secretCharacter,
  );
  assert.equal(await application.locationQueries.get(canonicalNovelReadScope, locationId), undefined);

  const duplicate = await application.commits.commit(sessionA, {
    commitId: commitIdA,
    resultRevision: resultRevisionA,
    committedAt: committedAtA,
  });
  assert.equal(duplicate.status, "duplicate");
  assert.deepEqual(duplicate.commit, committed.commit);

  const commitIdB = captureNovelCommitId("commit_b");
  await assert.rejects(
    application.commits.commit(sessionB, {
      commitId: commitIdB,
      resultRevision: captureNovelRevision("revision_commit_b"),
      committedAt: captureNovelTimestamp("2026-08-02T11:31:00.000Z"),
    }),
    (error) =>
      error instanceof NovelRevisionConflictError &&
      error.expectedRevision === "revision_commit_base" &&
      error.actualRevision === resultRevisionA,
  );
  assert.equal(await application.locationQueries.get(canonicalNovelReadScope, locationId), undefined);

  const stalePayloadPath = join(location.commitHistoryDir, "commit_b.json");
  await access(stalePayloadPath);
  await application.commits.commit(sessionA, {
    commitId: commitIdA,
    resultRevision: resultRevisionA,
    committedAt: committedAtA,
  });
  await assert.rejects(access(stalePayloadPath));

  const state = inspectCanonical(location.canonicalDatabasePath);
  assert.equal(state.metadata.current_revision, resultRevisionA);
  assert.equal(state.commits.length, 1);
  assert.equal(state.commits[0].payload_ref, "commit_a.json");
  assert.equal(state.outbox.length, 1);
  assert.equal(state.outbox[0].event_json.includes(secretCharacter), false);
  assert.equal(state.outbox[0].event_json.includes(secretLocation), false);
  const payloadBytes = await readFile(join(location.commitHistoryDir, "commit_a.json"));
  assert.equal(payloadBytes.byteLength, state.commits[0].payload_size);
  assert.equal((await draftStore.getDraftSession(canonical.novelId, sessionA.id)).status, "committed");
  assert.equal((await draftStore.getDraftSession(canonical.novelId, sessionB.id)).status, "active");

  await unlink(join(location.commitHistoryDir, "commit_a.json"));
  const restarted = createNodeNovelEntityApplication({
    location,
    novelId: canonical.novelId,
    identityFactory: new OperationIdentityFactory(),
    clock,
    logger,
  });
  const recovered = await restarted.commitRecovery.recover(canonical.novelId);
  assert.equal(recovered.recoveredCount, 1);
  assert.deepEqual(
    await readFile(join(location.commitHistoryDir, "commit_a.json")),
    payloadBytes,
  );

  await unlink(join(location.commitHistoryDir, "commit_a.json"));
  await rm(
    join(location.stagingDir, sessionA.ownerConversationId, sessionA.id),
    { recursive: true, force: true },
  );
  await assert.rejects(
    restarted.commitRecovery.recover(canonical.novelId),
    (error) => error instanceof NovelCommitHistoryIntegrityError,
  );
  assertRedacted(logs, [root, secretCharacter, secretLocation]);
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}

console.log("novel commit smoke passed");
