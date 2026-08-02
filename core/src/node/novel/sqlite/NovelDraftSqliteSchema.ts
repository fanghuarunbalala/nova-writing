/** Versioned Draft-only SQLite control schema for atomic Operation writes. */
import { DatabaseSync } from "node:sqlite";
import {
  captureNovelDraftSession,
  captureNovelTimestamp,
  type NovelDraftSession,
} from "../../../novel/index.js";

export const LATEST_NOVEL_DRAFT_SCHEMA_VERSION = 1 as const;

export function initializeNovelDraftSqliteSchema(
  databasePath: string,
  session: NovelDraftSession,
): void {
  const captured = captureNovelDraftSession(session);
  const database = new DatabaseSync(databasePath);
  try {
    configure(database);
    database.exec(`
      CREATE TABLE IF NOT EXISTS draft_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      ) STRICT;
    `);
    const applied = database
      .prepare(
        "SELECT version, name FROM draft_schema_migrations ORDER BY version",
      )
      .all() as Array<{ version: number; name: string }>;
    if (
      applied.some(
        (row, index) =>
          row.version !== index + 1 ||
          row.name !== DRAFT_MIGRATIONS[index]?.name,
      ) ||
      (applied.at(-1)?.version ?? 0) > LATEST_NOVEL_DRAFT_SCHEMA_VERSION
    ) {
      throw new Error();
    }

    for (const migration of DRAFT_MIGRATIONS) {
      if (applied.some((row) => row.version === migration.version)) continue;
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(migration.sql);
        database
          .prepare(
            "INSERT INTO draft_schema_migrations(version, name) VALUES (?, ?)",
          )
          .run(migration.version, migration.name);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }

    bindDraftMetadata(database, captured);
  } finally {
    database.close();
  }
}

const DRAFT_MIGRATIONS = [
  {
    version: 1,
    name: "draft_operation_control_plane",
    sql: `
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

      CREATE INDEX draft_operations_type_sequence_idx
      ON draft_operations(operation_type, sequence);

      CREATE TABLE draft_conflicts (
        conflict_id TEXT PRIMARY KEY,
        source_operation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        conflict_json TEXT NOT NULL,
        conflict_digest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      ) STRICT;

      CREATE TABLE draft_projection_state (
        projection_key TEXT PRIMARY KEY,
        source_sequence INTEGER NOT NULL CHECK (source_sequence >= 0),
        projection_version INTEGER NOT NULL CHECK (projection_version > 0),
        projection_digest TEXT NOT NULL,
        updated_at TEXT NOT NULL
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

      CREATE INDEX draft_outbox_unpublished_idx
      ON draft_outbox(operation_sequence, event_id)
      WHERE published_at IS NULL;
    `,
  },
] as const;

function bindDraftMetadata(
  database: DatabaseSync,
  session: NovelDraftSession,
): void {
  const existing = database
    .prepare(
      `SELECT draft_session_id, novel_id, owner_conversation_id, base_revision,
              schema_version, created_at, updated_at
       FROM draft_metadata WHERE singleton = 1`,
    )
    .get() as
    | {
        draft_session_id: string;
        novel_id: string;
        owner_conversation_id: string;
        base_revision: string;
        schema_version: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (existing === undefined) {
    database
      .prepare(
        `INSERT INTO draft_metadata(
           singleton, draft_session_id, novel_id, owner_conversation_id,
           base_revision, schema_version, operation_count,
           last_operation_sequence, last_operation_digest, created_at, updated_at
         ) VALUES (1, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?)`,
      )
      .run(
        session.id,
        session.novelId,
        session.ownerConversationId,
        session.baseRevision,
        LATEST_NOVEL_DRAFT_SCHEMA_VERSION,
        session.createdAt,
        session.updatedAt,
      );
    return;
  }
  if (
    existing.draft_session_id !== session.id ||
    existing.novel_id !== session.novelId ||
    existing.owner_conversation_id !== session.ownerConversationId ||
    existing.base_revision !== session.baseRevision ||
    existing.schema_version !== LATEST_NOVEL_DRAFT_SCHEMA_VERSION
  ) {
    throw new Error();
  }
  captureNovelTimestamp(existing.created_at);
  captureNovelTimestamp(existing.updated_at);
}

function configure(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}
