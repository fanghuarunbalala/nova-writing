import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_INVARIANT_FAILURE,
  NovelDraftOperationPersistenceError,
  NovelDraftOperationWriter,
  NovelDraftSessionService,
  NovelInvariantViolationError,
  NovelOperationExecutor,
  NovelOperationIdentityConflictError,
  NovelOperationRegistry,
  captureNovelOperationId,
  captureNovelOperationVersion,
  captureNovelTimestamp,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeSha256NovelOperationDigester,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelDraftOperationStore,
  SqliteNovelDraftStore,
  SqliteNovelSnapshotter,
} from "../dist/node/index.js";

class FixedIdentityFactory {
  createDraftSessionId() { return "draft_operation_writer"; }
}

class SequenceClock {
  constructor() { this.offset = 0; }
  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 2, 2, 0, 0, this.offset++)).toISOString(),
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

function operation(id, amount, secret = "") {
  return {
    operationId: captureNovelOperationId(id),
    operationVersion: captureNovelOperationVersion(1),
    type: "test.counter-add",
    expected: [],
    payload: { amount, secret },
  };
}

function readDraftState(path) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      counter: database.prepare("SELECT value FROM test_counter").get().value,
      operations: database.prepare("SELECT COUNT(*) AS count FROM draft_operations").get().count,
      outbox: database.prepare("SELECT COUNT(*) AS count FROM draft_outbox").get().count,
      metadata: database.prepare(
        `SELECT operation_count, last_operation_sequence, last_operation_digest
         FROM draft_metadata WHERE singleton = 1`,
      ).get(),
      controlTables: database
        .prepare(
          `SELECT name FROM sqlite_schema
           WHERE type = 'table' AND name LIKE 'draft_%'
           ORDER BY name`,
        )
        .all()
        .map((row) => row.name),
      outboxRows: database
        .prepare(
          `SELECT event_type, event_json, event_digest
           FROM draft_outbox ORDER BY operation_sequence`,
        )
        .all(),
      sequences: database
        .prepare("SELECT sequence FROM draft_operations ORDER BY sequence")
        .all()
        .map((row) => row.sequence),
    };
  } finally {
    database.close();
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-draft-operation-"));
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
  const session = await new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter,
    identityFactory: new FixedIdentityFactory(),
    clock,
    logger,
  }).startDraft("conversation-operation-writer");

  const registry = new NovelOperationRegistry();
  registry.register({
    operationType: "test.counter-add",
    operationVersion: captureNovelOperationVersion(1),
    apply(database, value) {
      database.exec(
        "CREATE TABLE IF NOT EXISTS test_counter(singleton INTEGER PRIMARY KEY, value INTEGER NOT NULL) STRICT",
      );
      database.exec("INSERT OR IGNORE INTO test_counter(singleton, value) VALUES (1, 0)");
      database.prepare("UPDATE test_counter SET value = value + ? WHERE singleton = 1").run(
        value.payload.amount,
      );
    },
  });
  registry.register({
    operationType: "test.raw-fail",
    operationVersion: captureNovelOperationVersion(1),
    apply() {
      throw new Error("FORBIDDEN_RAW_HANDLER_ERROR");
    },
  });
  registry.register({
    operationType: "test.always-fail",
    operationVersion: captureNovelOperationVersion(1),
    apply() {
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.operationRejected,
      );
    },
  });

  const operationStore = new SqliteNovelDraftOperationStore({
    location,
    novelId: canonical.novelId,
    contextFactory: (database) => database,
    logger,
  });
  const writer = new NovelDraftOperationWriter({
    store: operationStore,
    executor: new NovelOperationExecutor(registry),
    digester: new NodeSha256NovelOperationDigester(),
    clock,
    logger,
  });

  const secret = "FORBIDDEN_OPERATION_PAYLOAD_TEXT";
  const firstOperation = operation("operation_writer_1", 2, secret);
  const first = await writer.enqueue(session, firstOperation);
  assert.equal(first.status, "appended");
  assert.equal(first.sequence, 1);
  assert.match(first.digest, /^sha256:[0-9a-f]{64}$/u);
  const duplicate = await writer.enqueue(session, {
    ...firstOperation,
    payload: { secret, amount: 2 },
  });
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.sequence, 1);
  assert.equal(duplicate.digest, first.digest);
  await assert.rejects(
    () => writer.enqueue(session, operation("operation_writer_1", 99)),
    NovelOperationIdentityConflictError,
  );

  const concurrent = await Promise.all([
    writer.enqueue(session, operation("operation_writer_2", 3)),
    writer.enqueue(session, operation("operation_writer_3", 4)),
  ]);
  assert.deepEqual(concurrent.map((receipt) => receipt.sequence), [2, 3]);

  await assert.rejects(
    () =>
      writer.enqueue(session, {
        operationId: captureNovelOperationId("operation_writer_failed"),
        operationVersion: captureNovelOperationVersion(1),
        type: "test.always-fail",
        expected: [],
        payload: {},
      }),
    NovelInvariantViolationError,
  );
  await assert.rejects(
    () =>
      writer.enqueue(session, {
        operationId: captureNovelOperationId("operation_writer_raw_failed"),
        operationVersion: captureNovelOperationVersion(1),
        type: "test.raw-fail",
        expected: [],
        payload: {},
      }),
    NovelDraftOperationPersistenceError,
  );
  const afterFailure = await writer.enqueue(
    session,
    operation("operation_writer_4", 5),
  );
  assert.equal(afterFailure.sequence, 4);

  const databasePath = join(
    location.stagingDir,
    session.ownerConversationId,
    session.id,
    "draft.sqlite",
  );
  const state = readDraftState(databasePath);
  assert.equal(state.counter, 14);
  assert.equal(state.operations, 4);
  assert.equal(state.outbox, 4);
  assert.equal(state.metadata.operation_count, 4);
  assert.equal(state.metadata.last_operation_sequence, 4);
  assert.equal(state.metadata.last_operation_digest, afterFailure.digest);
  assert.deepEqual(state.sequences, [1, 2, 3, 4]);
  assert.deepEqual(state.controlTables, [
    "draft_approvals",
    "draft_conflicts",
    "draft_metadata",
    "draft_operations",
    "draft_outbox",
    "draft_projection_state",
    "draft_schema_migrations",
  ]);
  assert.equal(
    state.outboxRows.every(
      (row) =>
        row.event_type === "novel.draft.operation-applied" &&
        /^sha256:[0-9a-f]{64}$/u.test(row.event_digest) &&
        !row.event_json.includes(secret),
    ),
    true,
  );

  const restartedWriter = new NovelDraftOperationWriter({
    store: new SqliteNovelDraftOperationStore({
      location,
      novelId: canonical.novelId,
      contextFactory: (database) => database,
      logger,
    }),
    executor: new NovelOperationExecutor(registry),
    digester: new NodeSha256NovelOperationDigester(),
    clock,
    logger,
  });
  const restarted = await restartedWriter.enqueue(
    session,
    operation("operation_writer_5", 1),
  );
  assert.equal(restarted.sequence, 5);
  assert.equal(readDraftState(databasePath).counter, 15);

  const serializedLogs = JSON.stringify(logEntries);
  assert.equal(serializedLogs.includes(secret), false);
  assert.equal(serializedLogs.includes(root), false);
  assert.equal(serializedLogs.includes("FORBIDDEN_RAW_HANDLER_ERROR"), false);
  for (const entry of logEntries) {
    for (const field of ["payload", "path", "sql", "message", "stack", "cause"]) {
      assert.equal(Object.hasOwn(entry.fields, field), false);
    }
  }
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}

console.log("novel draft operation writer smoke passed");
