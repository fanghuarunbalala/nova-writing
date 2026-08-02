/** Versioned Draft-only SQLite control schema for atomic Operation writes. */
import { DatabaseSync } from "node:sqlite";
import {
  captureNovelDraftSession,
  captureNovelTimestamp,
  type NovelDraftSession,
} from "../../../novel/index.js";
import { NOVEL_ENTITY_SCHEMA_SQL } from "./NovelEntitySqliteSchema.js";

export const LATEST_NOVEL_DRAFT_SCHEMA_VERSION = 7 as const;

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
  {
    version: 2,
    name: "character_location_profiles",
    sql: `${NOVEL_ENTITY_SCHEMA_SQL.replaceAll(
      "CREATE TABLE ",
      "CREATE TABLE IF NOT EXISTS ",
    ).replaceAll("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ")}
      UPDATE draft_metadata SET schema_version = 2;
    `,
  },
  {
    version: 3,
    name: "draft_change_set_freeze",
    sql: `
      ALTER TABLE draft_metadata
      ADD COLUMN change_set_state TEXT NOT NULL DEFAULT 'open'
      CHECK (change_set_state IN ('open', 'frozen'));

      ALTER TABLE draft_metadata
      ADD COLUMN change_set_digest TEXT;

      ALTER TABLE draft_metadata
      ADD COLUMN change_set_frozen_at TEXT;

      UPDATE draft_metadata SET schema_version = 3;
    `,
  },
  {
    version: 4,
    name: "conflict_resolution",
    sql: `
      CREATE TABLE IF NOT EXISTS draft_conflicts (
        conflict_id TEXT PRIMARY KEY,
        source_operation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        conflict_json TEXT NOT NULL,
        conflict_digest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      ) STRICT;
      ALTER TABLE draft_conflicts ADD COLUMN resolution_json TEXT;
      ALTER TABLE draft_conflicts ADD COLUMN resolution_digest TEXT;
      UPDATE draft_metadata SET schema_version = 4;
    `,
  },
  {
    version: 5,
    name: "resolution_application_plan",
    sql: `
      CREATE TABLE resolution_application_plan (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        plan_version INTEGER NOT NULL CHECK (plan_version > 0),
        source_draft_session_id TEXT NOT NULL,
        conflicted_candidate_draft_session_id TEXT NOT NULL UNIQUE,
        base_revision TEXT NOT NULL,
        source_operation_count INTEGER NOT NULL CHECK (source_operation_count >= 0),
        effective_operation_count INTEGER NOT NULL CHECK (effective_operation_count >= 0),
        plan_json TEXT NOT NULL,
        plan_digest TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE resolution_application_entries (
        source_sequence INTEGER PRIMARY KEY CHECK (source_sequence > 0),
        action TEXT NOT NULL CHECK (
          action IN ('apply-original', 'apply-replacement', 'skip')
        ),
        conflict_id TEXT,
        strategy TEXT CHECK (
          strategy IS NULL OR strategy IN (
            'keep-canonical', 'keep-draft', 'drop-operation', 'manual'
          )
        ),
        operation_json TEXT,
        operation_digest TEXT,
        entry_json TEXT NOT NULL
      ) STRICT;

      UPDATE draft_metadata SET schema_version = 5;
    `,
  },
  {
    version: 6,
    name: "change_set_approval",
    sql: `
      CREATE TABLE draft_approvals (
        approval_digest TEXT PRIMARY KEY,
        approval_json TEXT NOT NULL,
        base_revision TEXT NOT NULL,
        change_set_digest TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'invalidated')),
        granted_at TEXT NOT NULL,
        invalidated_at TEXT,
        invalidation_reason TEXT
      ) STRICT;

      CREATE UNIQUE INDEX draft_approvals_one_active_idx
      ON draft_approvals(status) WHERE status = 'active';

      UPDATE draft_metadata SET schema_version = 6;
    `,
  },
  {
    version: 7,
    name: "general_lifecycle_outbox",
    sql: `
      DROP INDEX IF EXISTS draft_outbox_unpublished_idx;
      ALTER TABLE draft_outbox RENAME TO draft_outbox_v1;

      CREATE TABLE draft_outbox (
        event_id TEXT PRIMARY KEY,
        novel_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        operation_sequence INTEGER,
        operation_id TEXT,
        event_type TEXT NOT NULL,
        schema_version INTEGER NOT NULL CHECK (schema_version > 0),
        event_json TEXT NOT NULL,
        event_digest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        published_at TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        CHECK ((operation_sequence IS NULL) = (operation_id IS NULL)),
        FOREIGN KEY (operation_sequence) REFERENCES draft_operations(sequence),
        FOREIGN KEY (operation_id) REFERENCES draft_operations(operation_id)
      ) STRICT;

      INSERT INTO draft_outbox(
        event_id, novel_id, conversation_id, operation_sequence, operation_id,
        event_type, schema_version, event_json, event_digest, created_at,
        published_at, attempt_count
      )
      SELECT event_id, metadata.novel_id, metadata.owner_conversation_id,
             operation_sequence, operation_id, event_type, 1, event_json,
             event_digest, outbox.created_at, published_at, attempt_count
      FROM draft_outbox_v1 AS outbox
      CROSS JOIN draft_metadata AS metadata
      WHERE metadata.singleton = 1;

      DROP TABLE draft_outbox_v1;

      CREATE UNIQUE INDEX draft_outbox_operation_sequence_idx
      ON draft_outbox(operation_sequence) WHERE operation_sequence IS NOT NULL;
      CREATE UNIQUE INDEX draft_outbox_operation_id_idx
      ON draft_outbox(operation_id) WHERE operation_id IS NOT NULL;
      CREATE INDEX draft_outbox_unpublished_idx
      ON draft_outbox(created_at, event_id) WHERE published_at IS NULL;

      UPDATE draft_metadata SET schema_version = 7;
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
