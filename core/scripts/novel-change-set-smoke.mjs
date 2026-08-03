import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_DRAFT_SESSION_STATUS,
  NOVEL_INVARIANT_FAILURE,
  NovelDraftChangeSetFrozenError,
  NovelDraftSessionService,
  NovelInvariantViolationError,
  canonicalizeNovelChangeSetIdentity,
  captureCharacterId,
  captureLocationId,
  captureNovelDraftSession,
  captureNovelDraftSessionId,
  captureNovelOperationId,
  captureNovelRevision,
  captureNovelTimestamp,
} from "../dist/index.js";
import {
  LATEST_NOVEL_DRAFT_SCHEMA_VERSION,
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelDraftStore,
  SqliteNovelSnapshotter,
  createNodeNovelEntityApplication,
  initializeNovelDraftSqliteSchema,
} from "../dist/node/index.js";

class SequenceDraftIdentityFactory {
  constructor() {
    this.sequence = 0;
  }

  createDraftSessionId() {
    this.sequence += 1;
    return captureNovelDraftSessionId(`draft_change_set_${this.sequence}`);
  }
}

class SequenceOperationIdentityFactory {
  constructor() {
    this.sequence = 0;
  }

  createOperationId() {
    this.sequence += 1;
    return captureNovelOperationId(`change_set_operation_${this.sequence}`);
  }
}

class SequenceClock {
  constructor() {
    this.offset = 0;
  }

  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 2, 9, 0, 0, this.offset++)).toISOString(),
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
    return new CollectingLogger(this.entries, {
      ...this.bindings,
      ...bindings,
    });
  }

  record(level, event, fields) {
    this.entries.push({
      level,
      event,
      fields: { ...this.bindings, ...fields },
    });
  }
}

function draftDatabasePath(location, session) {
  return join(
    location.stagingDir,
    session.ownerConversationId,
    session.id,
    "draft.sqlite",
  );
}

function inspectFreeze(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return {
      metadata: database
        .prepare(
          `SELECT schema_version, operation_count, last_operation_sequence,
                  change_set_state, change_set_digest, change_set_frozen_at
           FROM draft_metadata WHERE singleton = 1`,
        )
        .get(),
      sequences: database
        .prepare("SELECT sequence FROM draft_operations ORDER BY sequence")
        .all()
        .map((row) => row.sequence),
    };
  } finally {
    database.close();
  }
}

function assertRedacted(entries, forbiddenValues) {
  const serialized = JSON.stringify(entries);
  for (const value of forbiddenValues) {
    assert.equal(serialized.includes(value), false);
  }
  for (const entry of entries) {
    for (const field of [
      "payload",
      "profile",
      "content",
      "text",
      "path",
      "sql",
      "error",
      "message",
      "stack",
      "cause",
      "stderr",
    ]) {
      assert.equal(Object.hasOwn(entry.fields, field), false);
    }
  }
}

function createLegacyDraftDatabase(databasePath, session) {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TABLE draft_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      ) STRICT;

      INSERT INTO draft_schema_migrations(version, name)
      VALUES (1, 'draft_operation_control_plane');

      CREATE TABLE draft_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        draft_session_id TEXT NOT NULL UNIQUE,
        novel_id TEXT NOT NULL,
        owner_conversation_id TEXT NOT NULL,
        base_revision TEXT NOT NULL,
        schema_version INTEGER NOT NULL CHECK (schema_version > 0),
        operation_count INTEGER NOT NULL DEFAULT 0 CHECK (operation_count >= 0),
        last_operation_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_operation_sequence >= 0),
        last_operation_digest TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE draft_operations (
        sequence INTEGER PRIMARY KEY CHECK (sequence > 0),
        operation_id TEXT NOT NULL UNIQUE,
        operation_type TEXT NOT NULL,
        operation_version INTEGER NOT NULL CHECK (operation_version > 0),
        operation_json TEXT NOT NULL,
        operation_digest TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE draft_outbox (
        event_id TEXT PRIMARY KEY,
        operation_sequence INTEGER NOT NULL UNIQUE,
        operation_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        event_json TEXT NOT NULL,
        event_digest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        published_at TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        FOREIGN KEY (operation_sequence) REFERENCES draft_operations(sequence),
        FOREIGN KEY (operation_id) REFERENCES draft_operations(operation_id)
      ) STRICT;
    `);
    database
      .prepare(
        `INSERT INTO draft_metadata(
           singleton, draft_session_id, novel_id, owner_conversation_id,
           base_revision, schema_version, operation_count,
           last_operation_sequence, last_operation_digest, created_at, updated_at
         ) VALUES (1, ?, ?, ?, ?, 1, 0, 0, NULL, ?, ?)`,
      )
      .run(
        session.id,
        session.novelId,
        session.ownerConversationId,
        session.baseRevision,
        session.createdAt,
        session.updatedAt,
      );
  } finally {
    database.close();
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-change-set-"));
const workspaceRoot = join(root, "workspace");
const logEntries = [];
const logger = new CollectingLogger(logEntries);
let canonicalStore;
let draftStore;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  canonicalStore = await SqliteNovelCanonicalStore.open({ location, logger });
  const canonical = await canonicalStore.getMetadata();
  draftStore = await SqliteNovelDraftStore.open({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const clock = new SequenceClock();
  const snapshotter = new SqliteNovelSnapshotter({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const draftSessions = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter,
    identityFactory: new SequenceDraftIdentityFactory(),
    clock,
    logger,
  });
  const session = await draftSessions.startDraft("conversation-change-set");
  const corruptSession = await draftSessions.startDraft(
    "conversation-change-set-corrupt",
  );
  const identityFactory = new SequenceOperationIdentityFactory();
  const application = createNodeNovelEntityApplication({
    location,
    novelId: canonical.novelId,
    identityFactory,
    clock,
    logger,
  });
  const forbiddenCharacter = "FORBIDDEN_CHANGE_SET_CHARACTER";
  const forbiddenLocation = "FORBIDDEN_CHANGE_SET_LOCATION";

  const characterWrite = application.characters.create(
    session,
    captureCharacterId("character_change_set"),
    {
      name: forbiddenCharacter,
      aliases: ["Frozen Hero"],
      summary: "Content must not enter structured logs.",
    },
  );
  const locationWrite = application.locations.create(
    session,
    captureLocationId("location_change_set"),
    {
      name: forbiddenLocation,
      aliases: ["Frozen Place"],
    },
  );
  const [, , changeSet] = await Promise.all([
    characterWrite,
    locationWrite,
    application.changeSets.build(session),
  ]);

  assert.equal(changeSet.operationCount, 2);
  assert.equal(changeSet.lastOperationSequence, 2);
  assert.deepEqual(changeSet.operations.map((entry) => entry.sequence), [1, 2]);
  assert.equal(Object.isFrozen(changeSet), true);
  assert.equal(Object.isFrozen(changeSet.operations), true);
  assert.equal(Object.isFrozen(changeSet.operations[0].operation), true);
  assert.match(changeSet.digest, /^sha256:[0-9a-f]{64}$/u);
  const canonicalIdentity = canonicalizeNovelChangeSetIdentity(changeSet);
  const expectedDigest = `sha256:${createHash("sha256")
    .update(canonicalIdentity, "utf8")
    .digest("hex")}`;
  assert.equal(changeSet.digest, expectedDigest);
  assert.equal(canonicalIdentity.includes(forbiddenCharacter), false);
  assert.equal(canonicalIdentity.includes(forbiddenLocation), false);

  const frozenAgain = await application.changeSets.build(session);
  assert.equal(frozenAgain.digest, changeSet.digest);
  assert.equal(frozenAgain.frozenAt, changeSet.frozenAt);

  await assert.rejects(
    application.characters.create(
      session,
      captureCharacterId("character_after_freeze"),
      { name: "Rejected After Freeze", aliases: [] },
    ),
    NovelDraftChangeSetFrozenError,
  );

  const restarted = createNodeNovelEntityApplication({
    location,
    novelId: canonical.novelId,
    identityFactory,
    clock,
    logger,
  });
  const recovered = await restarted.changeSets.build(session);
  assert.equal(recovered.digest, changeSet.digest);
  assert.equal(recovered.frozenAt, changeSet.frozenAt);

  const state = inspectFreeze(draftDatabasePath(location, session));
  assert.equal(state.metadata.schema_version, LATEST_NOVEL_DRAFT_SCHEMA_VERSION);
  assert.equal(state.metadata.operation_count, 2);
  assert.equal(state.metadata.last_operation_sequence, 2);
  assert.equal(state.metadata.change_set_state, "frozen");
  assert.equal(state.metadata.change_set_digest, changeSet.digest);
  assert.equal(state.metadata.change_set_frozen_at, changeSet.frozenAt);
  assert.deepEqual(state.sequences, [1, 2]);

  await application.characters.create(
    corruptSession,
    captureCharacterId("character_corrupt_change_set"),
    { name: "Corrupt Source", aliases: [] },
  );
  const corruptDatabase = new DatabaseSync(
    draftDatabasePath(location, corruptSession),
  );
  corruptDatabase
    .prepare("UPDATE draft_operations SET operation_json = '{}' WHERE sequence = 1")
    .run();
  corruptDatabase.close();
  await assert.rejects(
    restarted.changeSets.build(corruptSession),
    (error) =>
      error instanceof NovelInvariantViolationError &&
      error.failure === NOVEL_INVARIANT_FAILURE.persistenceInvariant,
  );

  const legacySession = captureNovelDraftSession({
    id: captureNovelDraftSessionId("draft_change_set_legacy"),
    novelId: canonical.novelId,
    ownerConversationId: "conversation-change-set-legacy",
    baseRevision: captureNovelRevision(canonical.currentRevision),
    status: NOVEL_DRAFT_SESSION_STATUS.active,
    createdAt: clock.now(),
    updatedAt: clock.now(),
  });
  const legacyPath = join(root, "legacy-draft.sqlite");
  createLegacyDraftDatabase(legacyPath, legacySession);
  initializeNovelDraftSqliteSchema(legacyPath, legacySession);
  const legacyDatabase = new DatabaseSync(legacyPath, { readOnly: true });
  const legacyMetadata = legacyDatabase
    .prepare(
      `SELECT schema_version, change_set_state, change_set_digest,
              change_set_frozen_at
       FROM draft_metadata WHERE singleton = 1`,
    )
    .get();
  const legacyMigrations = legacyDatabase
    .prepare("SELECT version FROM draft_schema_migrations ORDER BY version")
    .all()
    .map((row) => row.version);
  legacyDatabase.close();
  assert.equal(legacyMetadata.schema_version, LATEST_NOVEL_DRAFT_SCHEMA_VERSION);
  assert.equal(legacyMetadata.change_set_state, "open");
  assert.equal(legacyMetadata.change_set_digest, null);
  assert.equal(legacyMetadata.change_set_frozen_at, null);
  assert.deepEqual(
    legacyMigrations,
    Array.from(
      { length: LATEST_NOVEL_DRAFT_SCHEMA_VERSION },
      (_, index) => index + 1,
    ),
  );

  assertRedacted(logEntries, [
    root,
    forbiddenCharacter,
    forbiddenLocation,
    "Content must not enter structured logs.",
  ]);
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}

console.log("novel change set smoke passed");
