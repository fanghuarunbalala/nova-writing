/** Ordered canonical Novel SQLite migrations with strict monotonic validation. */
import type { DatabaseSync } from "node:sqlite";
import type { NovelClock, NovelSchemaVersion } from "../../../novel/index.js";
import {
  captureNovelSchemaVersion,
  captureNovelTimestamp,
} from "../../../novel/index.js";
import {
  NOVEL_DATABASE_FAILURE,
  NovelDatabaseError,
} from "./NovelDatabaseErrors.js";

interface NovelSqliteMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

const NOVEL_MIGRATIONS: readonly NovelSqliteMigration[] = [
  {
    version: 1,
    name: "novel_control_plane",
    sql: `
      CREATE TABLE novel_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        novel_id TEXT NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL UNIQUE,
        schema_version INTEGER NOT NULL CHECK (schema_version > 0),
        current_revision TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE novel_draft_sessions (
        id TEXT PRIMARY KEY,
        novel_id TEXT NOT NULL,
        owner_conversation_id TEXT NOT NULL,
        base_revision TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN (
            'active',
            'awaiting-approval',
            'rebasing',
            'conflicted',
            'committing',
            'committed',
            'rolled-back'
          )
        ),
        staging_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        terminal_at TEXT,
        FOREIGN KEY (novel_id) REFERENCES novel_metadata(novel_id)
      ) STRICT;

      CREATE UNIQUE INDEX novel_draft_sessions_one_active_owner_idx
      ON novel_draft_sessions(novel_id, owner_conversation_id)
      WHERE status IN ('active', 'awaiting-approval', 'rebasing', 'conflicted', 'committing');

      CREATE INDEX novel_draft_sessions_status_updated_idx
      ON novel_draft_sessions(novel_id, status, updated_at, id);

      CREATE TABLE novel_commits (
        commit_id TEXT PRIMARY KEY,
        novel_id TEXT NOT NULL,
        draft_session_id TEXT NOT NULL,
        owner_conversation_id TEXT NOT NULL,
        base_revision TEXT NOT NULL,
        result_revision TEXT NOT NULL UNIQUE,
        change_set_digest TEXT NOT NULL,
        payload_ref TEXT,
        payload_digest TEXT,
        payload_size INTEGER CHECK (payload_size IS NULL OR payload_size >= 0),
        committed_at TEXT NOT NULL,
        FOREIGN KEY (novel_id) REFERENCES novel_metadata(novel_id),
        FOREIGN KEY (draft_session_id) REFERENCES novel_draft_sessions(id)
      ) STRICT;

      CREATE INDEX novel_commits_novel_committed_idx
      ON novel_commits(novel_id, committed_at, commit_id);

      CREATE TABLE novel_outbox (
        event_id TEXT PRIMARY KEY,
        novel_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        schema_version INTEGER NOT NULL CHECK (schema_version > 0),
        event_json TEXT NOT NULL,
        event_digest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        published_at TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        FOREIGN KEY (novel_id) REFERENCES novel_metadata(novel_id)
      ) STRICT;

      CREATE INDEX novel_outbox_unpublished_idx
      ON novel_outbox(created_at, event_id)
      WHERE published_at IS NULL;
    `,
  },
];

export const LATEST_NOVEL_SCHEMA_VERSION: NovelSchemaVersion =
  captureNovelSchemaVersion(NOVEL_MIGRATIONS.at(-1)?.version ?? 1);

export function runNovelSqliteMigrations(
  database: DatabaseSync,
  clock: NovelClock,
): NovelSchemaVersion {
  assertNovelDatabaseCandidate(database);
  database.exec(`
    CREATE TABLE IF NOT EXISTS novel_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const appliedRows = database
    .prepare(
      "SELECT version, name, applied_at FROM novel_schema_migrations ORDER BY version",
    )
    .all() as Array<{ version: number; name: string; applied_at: string }>;
  const appliedVersions = appliedRows.map((row) => row.version);
  const maximumApplied = appliedVersions.at(-1) ?? 0;
  if (maximumApplied > LATEST_NOVEL_SCHEMA_VERSION) {
    throw new NovelDatabaseError(NOVEL_DATABASE_FAILURE.unsupportedSchema);
  }

  const hasInvalidHistory = appliedRows.some((row, index) => {
    const migration = NOVEL_MIGRATIONS[index];
    try {
      if (
        migration === undefined ||
        row.version !== migration.version ||
        row.name !== migration.name
      ) {
        return true;
      }
      captureNovelTimestamp(row.applied_at);
      return false;
    } catch {
      return true;
    }
  });
  if (hasInvalidHistory) {
    throw new NovelDatabaseError(NOVEL_DATABASE_FAILURE.unsupportedSchema);
  }

  const insertMigration = database.prepare(
    "INSERT INTO novel_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
  );
  for (const migration of NOVEL_MIGRATIONS) {
    if (appliedVersions.includes(migration.version)) continue;

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      insertMigration.run(migration.version, migration.name, clock.now());
      database
        .prepare(
          "UPDATE novel_metadata SET schema_version = ? WHERE singleton = 1",
        )
        .run(migration.version);
      database.exec("COMMIT");
    } catch {
      database.exec("ROLLBACK");
      throw new NovelDatabaseError(NOVEL_DATABASE_FAILURE.invalidStructure);
    }
  }

  return LATEST_NOVEL_SCHEMA_VERSION;
}

function assertNovelDatabaseCandidate(database: DatabaseSync): void {
  const rows = database
    .prepare(
      `SELECT name
       FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as Array<{ name: string }>;
  if (
    rows.length > 0 &&
    !rows.some((row) => row.name === "novel_schema_migrations")
  ) {
    throw new NovelDatabaseError(NOVEL_DATABASE_FAILURE.invalidStructure);
  }
}
