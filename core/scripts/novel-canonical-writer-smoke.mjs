import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_LIFECYCLE_EVENT_TYPE,
  NovelOperationExecutor,
  NovelRevisionConflictError,
  captureNovelId,
  captureNovelOperationId,
  captureNovelRevision,
  captureNovelTimestamp,
  captureStoryOutline,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitId,
  createDefaultNovelOperationRegistry,
  createStoryOutlineCreateOperation,
  createStoryUnitCreateOperation,
} from "../dist/index.js";
import {
  SqliteNovelCanonicalStore,
  SqliteNovelCanonicalWriter,
  createSqliteNovelMutationContext,
} from "../dist/node/index.js";

const NOVEL_ID = captureNovelId("novel_canonical_writer");
const WORKSPACE_ID = "workspace_canonical_writer";
const CONVERSATION_ID = "conversation_canonical_writer";

class FixedIdentityFactory {
  createNovelId() {
    return NOVEL_ID;
  }
}

class InitialRevisionFactory {
  createRevision() {
    return captureNovelRevision("revision_initial");
  }
}

class SequenceRevisionFactory {
  constructor() {
    this.count = 0;
  }

  createRevision() {
    this.count += 1;
    return captureNovelRevision(`revision_writer_${this.count}`);
  }
}

class SequenceClock {
  constructor() {
    this.offset = 0;
  }

  now() {
    const timestamp = new Date(Date.UTC(2026, 7, 3, 0, 0, 0, this.offset));
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

function createIsolatedLocation(root) {
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    canonicalDatabasePath: join(root, "novel.sqlite"),
    stagingDir: join(root, "novel-staging"),
    historyDir: join(root, "novel-history"),
    commitHistoryDir: join(root, "novel-history", "commits"),
    artifactDir: join(root, "novel-artifacts"),
  });
}

async function assertLogsAreRedacted(entries, forbiddenValues) {
  const serialized = JSON.stringify(entries);
  for (const forbidden of forbiddenValues) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `log must not expose ${forbidden}`,
    );
  }
}

function readOutboxRows(databasePath) {
  const database = new DatabaseSync(databasePath);
  try {
    return database
      .prepare(
        `SELECT event_id, novel_id, conversation_id, event_type, schema_version
         FROM novel_outbox ORDER BY created_at, event_id`,
      )
      .all();
  } finally {
    database.close();
  }
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "novel-canonical-writer-"));
  const logger = new CollectingLogger();
  try {
    const location = createIsolatedLocation(root);
    await SqliteNovelCanonicalStore.open({
      location,
      novelId: NOVEL_ID,
      identityFactory: new FixedIdentityFactory(),
      revisionFactory: new InitialRevisionFactory(),
      logger,
    });
    const executor = new NovelOperationExecutor(
      createDefaultNovelOperationRegistry(),
    );
    const writer = new SqliteNovelCanonicalWriter({
      location,
      novelId: NOVEL_ID,
      executor,
      contextFactory: createSqliteNovelMutationContext,
      revisionFactory: new SequenceRevisionFactory(),
      clock: new SequenceClock(),
      logger,
    });

    const outlineId = captureStoryOutlineId("outline_canonical_writer");
    const outlineCreate = await writer.applyOperation({
      operation: createStoryOutlineCreateOperation({
        operationId: captureNovelOperationId("op_outline_create"),
        outline: captureStoryOutline({ id: outlineId, novelId: NOVEL_ID }),
      }),
      conversationId: CONVERSATION_ID,
      baseRevision: "revision_initial",
    });
    assert.equal(outlineCreate.status, "applied");
    assert.equal(outlineCreate.baseRevision, "revision_initial");
    assert.equal(outlineCreate.resultRevision, "revision_writer_1");

    const unitId = captureStoryUnitId("unit_canonical_writer_1");
    const unitCreate = await writer.applyOperation({
      operation: createStoryUnitCreateOperation({
        operationId: captureNovelOperationId("op_unit_create"),
        storyUnit: captureStoryUnit({
          id: unitId,
          outlineId,
          orderKey: "8000",
          title: "First Chapter",
          planningStatus: "idea",
          realizationStatus: "pending",
        }),
      }),
      conversationId: CONVERSATION_ID,
      baseRevision: outlineCreate.resultRevision,
    });
    assert.equal(unitCreate.status, "applied");
    assert.equal(unitCreate.baseRevision, "revision_writer_1");
    assert.equal(unitCreate.resultRevision, "revision_writer_2");

    // 乐观锁冲突：携带过期 baseRevision 的写入必须被拒绝。
    await assert.rejects(
      writer.applyOperation({
        operation: createStoryUnitCreateOperation({
          operationId: captureNovelOperationId("op_unit_stale"),
          storyUnit: captureStoryUnit({
            id: captureStoryUnitId("unit_canonical_writer_stale"),
            outlineId,
            orderKey: "80008000",
            title: "Stale Write",
            planningStatus: "idea",
            realizationStatus: "pending",
          }),
        }),
        conversationId: CONVERSATION_ID,
        baseRevision: outlineCreate.resultRevision,
      }),
      (error) => {
        assert.equal(error instanceof NovelRevisionConflictError, true);
        assert.equal(error.code, "NOVEL_REVISION_CONFLICT");
        assert.equal(error.expectedRevision, "revision_writer_1");
        assert.equal(error.actualRevision, "revision_writer_2");
        return true;
      },
    );

    // 数据已落 canonical，revision 已推进。
    const database = new DatabaseSync(location.canonicalDatabasePath);
    try {
      const metadata = database
        .prepare(
          "SELECT current_revision FROM novel_metadata WHERE singleton = 1",
        )
        .get();
      assert.equal(metadata.current_revision, "revision_writer_2");
      const unitRow = database
        .prepare(
          "SELECT id, content_json FROM novel_story_units WHERE id = ?",
        )
        .get(unitId);
      assert.equal(JSON.parse(unitRow.content_json).title, "First Chapter");
    } finally {
      database.close();
    }

    const outboxRows = readOutboxRows(location.canonicalDatabasePath);
    assert.equal(outboxRows.length, 2);
    assert.ok(
      outboxRows.every(
        (row) =>
          row.event_type === `novel.${NOVEL_LIFECYCLE_EVENT_TYPE.canonicalWriteApplied}` &&
          row.novel_id === NOVEL_ID &&
          row.conversation_id === CONVERSATION_ID,
      ),
    );

    await assertLogsAreRedacted(logger.entries, [root]);
    process.stdout.write("novel-canonical-writer smoke passed\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
