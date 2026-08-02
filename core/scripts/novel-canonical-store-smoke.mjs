import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  captureNovelId,
  captureNovelRevision,
  captureNovelTimestamp,
  captureNovelWorkspaceId,
} from "../dist/index.js";
import {
  LATEST_NOVEL_SCHEMA_VERSION,
  NOVEL_DATABASE_FAILURE,
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  NovelDatabaseError,
  SqliteNovelCanonicalStore,
} from "../dist/node/index.js";

class FixedIdentityFactory {
  createNovelId() {
    return captureNovelId("novel_canonical_smoke");
  }
}

class FixedRevisionFactory {
  createRevision() {
    return captureNovelRevision("revision_canonical_smoke");
  }
}

class SequenceClock {
  constructor() {
    this.offset = 0;
  }

  now() {
    const timestamp = new Date(Date.UTC(2026, 7, 2, 0, 0, 0, this.offset));
    this.offset += 1;
    return captureNovelTimestamp(timestamp.toISOString());
  }
}

class CollectingLogger {
  constructor(entries = [], bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }

  debug(event, fields = {}) {
    this.record("debug", event, fields);
  }

  info(event, fields = {}) {
    this.record("info", event, fields);
  }

  warn(event, fields = {}) {
    this.record("warn", event, fields);
  }

  error(event, fields = {}) {
    this.record("error", event, fields);
  }

  child(bindings) {
    return new CollectingLogger(this.entries, { ...this.bindings, ...bindings });
  }

  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

async function assertDirectory(path) {
  assert.equal((await stat(path)).isDirectory(), true);
}

async function assertOpenFailure(options, expectedFailure) {
  await assert.rejects(
    () => SqliteNovelCanonicalStore.open(options),
    (error) => {
      assert.equal(error instanceof NovelDatabaseError, true);
      assert.equal(error.failure, expectedFailure);
      assert.equal(error.message, "Novel database operation failed");
      return true;
    },
  );
}

function inspectControlTables(databasePath) {
  const database = new DatabaseSync(databasePath);
  try {
    return database
      .prepare(
        `SELECT name
         FROM sqlite_schema
         WHERE type = 'table' AND name LIKE 'novel_%'
         ORDER BY name`,
      )
      .all()
      .map((row) => row.name);
  } finally {
    database.close();
  }
}

function createIsolatedLocation(root, workspaceId) {
  return Object.freeze({
    workspaceId,
    canonicalDatabasePath: join(root, "novel.sqlite"),
    stagingDir: join(root, "novel-staging"),
    historyDir: join(root, "novel-history"),
    commitHistoryDir: join(root, "novel-history", "commits"),
    artifactDir: join(root, "novel-artifacts"),
  });
}

function assertLogsAreRedacted(entries, forbiddenValues) {
  const serialized = JSON.stringify(entries);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(serialized.includes(forbiddenValue), false);
  }
  for (const entry of entries) {
    for (const forbiddenField of [
      "payload",
      "novelText",
      "prompt",
      "config",
      "tool",
      "path",
      "sql",
      "message",
      "stack",
      "cause",
      "stderr",
    ]) {
      assert.equal(Object.hasOwn(entry.fields, forbiddenField), false);
    }
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-canonical-store-"));
const workspaceRoot = join(temporaryRoot, "workspace");
const storageRoot = join(temporaryRoot, "storage");
const logEntries = [];
const logger = new CollectingLogger(logEntries);

let store;
let reopenedStore;
try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({ storageRoot }).resolve(
    workspaceRoot,
  );
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  assert.equal(captureNovelWorkspaceId(workspace.workspaceId), workspace.workspaceId);

  assert.equal(basename(workspace.databasePath), "novel.db");
  assert.equal(basename(location.canonicalDatabasePath), "novel.sqlite");
  assert.notEqual(workspace.databasePath, location.canonicalDatabasePath);
  await assertDirectory(location.stagingDir);
  await assertDirectory(location.historyDir);
  await assertDirectory(location.commitHistoryDir);
  await assertDirectory(location.artifactDir);

  store = await SqliteNovelCanonicalStore.open({
    location,
    identityFactory: new FixedIdentityFactory(),
    revisionFactory: new FixedRevisionFactory(),
    clock: new SequenceClock(),
    logger,
  });
  const metadata = await store.getMetadata();
  assert.equal(Object.isFrozen(metadata), true);
  assert.equal(metadata.novelId, "novel_canonical_smoke");
  assert.equal(metadata.workspaceId, workspace.workspaceId);
  assert.equal(metadata.schemaVersion, LATEST_NOVEL_SCHEMA_VERSION);
  assert.equal(metadata.schemaVersion, 3);
  assert.equal(metadata.currentRevision, "revision_canonical_smoke");
  assert.equal(metadata.createdAt, "2026-08-02T00:00:00.003Z");
  assert.equal(metadata.updatedAt, metadata.createdAt);
  assert.deepEqual(inspectControlTables(location.canonicalDatabasePath), [
    "novel_characters",
    "novel_commits",
    "novel_draft_sessions",
    "novel_locations",
    "novel_metadata",
    "novel_outbox",
    "novel_rebase_candidates",
    "novel_schema_migrations",
  ]);

  await store.close();
  await store.close();
  await assert.rejects(
    () => store.getMetadata(),
    (error) =>
      error instanceof NovelDatabaseError &&
      error.failure === NOVEL_DATABASE_FAILURE.closed,
  );
  store = undefined;

  reopenedStore = await SqliteNovelCanonicalStore.open({
    location,
    expectedNovelId: captureNovelId("novel_canonical_smoke"),
    logger,
  });
  assert.deepEqual(await reopenedStore.getMetadata(), metadata);
  await reopenedStore.close();
  reopenedStore = undefined;

  await assertOpenFailure(
    {
      location,
      expectedNovelId: captureNovelId("novel_wrong_identity"),
      logger,
    },
    NOVEL_DATABASE_FAILURE.novelMismatch,
  );
  await assertOpenFailure(
    {
      location: Object.freeze({ ...location, workspaceId: "ws-wrong-workspace" }),
      logger,
    },
    NOVEL_DATABASE_FAILURE.workspaceMismatch,
  );

  const futureRoot = join(temporaryRoot, "future-schema");
  await mkdir(futureRoot, { recursive: true });
  const futureLocation = createIsolatedLocation(futureRoot, "ws-future-schema");
  const futureDatabase = new DatabaseSync(futureLocation.canonicalDatabasePath);
  futureDatabase.exec(`
    CREATE TABLE novel_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
    INSERT INTO novel_schema_migrations(version, name, applied_at)
    VALUES (999, 'future_schema', '2026-08-02T00:00:00.000Z');
  `);
  futureDatabase.close();
  await assertOpenFailure(
    { location: futureLocation, logger },
    NOVEL_DATABASE_FAILURE.unsupportedSchema,
  );

  const alteredHistoryRoot = join(temporaryRoot, "altered-history");
  await mkdir(alteredHistoryRoot, { recursive: true });
  const alteredHistoryLocation = createIsolatedLocation(
    alteredHistoryRoot,
    "ws-altered-history",
  );
  const alteredHistoryDatabase = new DatabaseSync(
    alteredHistoryLocation.canonicalDatabasePath,
  );
  alteredHistoryDatabase.exec(`
    CREATE TABLE novel_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
    INSERT INTO novel_schema_migrations(version, name, applied_at)
    VALUES (1, 'altered_name', '2026-08-02T00:00:00.000Z');
  `);
  alteredHistoryDatabase.close();
  await assertOpenFailure(
    { location: alteredHistoryLocation, logger },
    NOVEL_DATABASE_FAILURE.unsupportedSchema,
  );

  const invalidMigrationTimestampRoot = join(
    temporaryRoot,
    "invalid-migration-timestamp",
  );
  await mkdir(invalidMigrationTimestampRoot, { recursive: true });
  const invalidMigrationTimestampLocation = createIsolatedLocation(
    invalidMigrationTimestampRoot,
    "ws-invalid-migration-timestamp",
  );
  const invalidMigrationTimestampDatabase = new DatabaseSync(
    invalidMigrationTimestampLocation.canonicalDatabasePath,
  );
  invalidMigrationTimestampDatabase.exec(`
    CREATE TABLE novel_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
    INSERT INTO novel_schema_migrations(version, name, applied_at)
    VALUES (1, 'novel_control_plane', 'not-a-timestamp');
  `);
  invalidMigrationTimestampDatabase.close();
  await assertOpenFailure(
    { location: invalidMigrationTimestampLocation, logger },
    NOVEL_DATABASE_FAILURE.unsupportedSchema,
  );

  const unrelatedRoot = join(temporaryRoot, "unrelated-database");
  await mkdir(unrelatedRoot, { recursive: true });
  const unrelatedLocation = createIsolatedLocation(
    unrelatedRoot,
    "ws-unrelated-database",
  );
  const unrelatedDatabase = new DatabaseSync(
    unrelatedLocation.canonicalDatabasePath,
  );
  unrelatedDatabase.exec("CREATE TABLE conversations(id TEXT PRIMARY KEY) STRICT;");
  unrelatedDatabase.close();
  await assertOpenFailure(
    { location: unrelatedLocation, logger },
    NOVEL_DATABASE_FAILURE.invalidStructure,
  );

  const malformedRoot = join(temporaryRoot, "malformed-schema");
  await mkdir(malformedRoot, { recursive: true });
  const malformedLocation = createIsolatedLocation(
    malformedRoot,
    "ws-malformed-schema",
  );
  const malformedDatabase = new DatabaseSync(
    malformedLocation.canonicalDatabasePath,
  );
  malformedDatabase.exec(`
    CREATE TABLE novel_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
    INSERT INTO novel_schema_migrations(version, name, applied_at)
    VALUES (1, 'novel_control_plane', '2026-08-02T00:00:00.000Z');
    CREATE TABLE novel_metadata (singleton INTEGER PRIMARY KEY) STRICT;
  `);
  malformedDatabase.close();
  await assertOpenFailure(
    { location: malformedLocation, logger },
    NOVEL_DATABASE_FAILURE.invalidStructure,
  );

  const missingControlRoot = join(temporaryRoot, "missing-control-table");
  await mkdir(missingControlRoot, { recursive: true });
  const missingControlLocation = createIsolatedLocation(
    missingControlRoot,
    "ws-missing-control-table",
  );
  const missingControlStore = await SqliteNovelCanonicalStore.open({
    location: missingControlLocation,
    identityFactory: new FixedIdentityFactory(),
    revisionFactory: new FixedRevisionFactory(),
    clock: new SequenceClock(),
    logger,
  });
  await missingControlStore.close();
  const missingControlDatabase = new DatabaseSync(
    missingControlLocation.canonicalDatabasePath,
  );
  missingControlDatabase.exec("DROP TABLE novel_outbox");
  missingControlDatabase.close();
  await assertOpenFailure(
    { location: missingControlLocation, logger },
    NOVEL_DATABASE_FAILURE.invalidStructure,
  );

  const directoryDatabaseRoot = join(temporaryRoot, "database-directory");
  await mkdir(directoryDatabaseRoot, { recursive: true });
  await assertOpenFailure(
    {
      location: Object.freeze({
        ...createIsolatedLocation(directoryDatabaseRoot, "ws-open-failure"),
        canonicalDatabasePath: directoryDatabaseRoot,
      }),
      logger,
    },
    NOVEL_DATABASE_FAILURE.invalidStructure,
  );

  assertLogsAreRedacted(logEntries, [
    temporaryRoot,
    "future_schema",
    "altered_name",
    "not-a-timestamp",
    "novel_control_plane",
    "CREATE TABLE",
    "SQLITE_",
  ]);
} finally {
  await store?.close();
  await reopenedStore?.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("novel canonical store smoke passed");
