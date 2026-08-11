import type { DatabaseSync } from "node:sqlite";

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "workspace_conversations_and_agent_bindings",
    sql: `
      CREATE TABLE workspace_metadata (
        workspace_id TEXT PRIMARY KEY,
        workspace_root TEXT NOT NULL,
        store_dir_name TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        parent_conversation_id TEXT,
        root_conversation_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'disposed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_journal_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_journal_sequence >= 0),
        FOREIGN KEY (workspace_id) REFERENCES workspace_metadata(workspace_id),
        FOREIGN KEY (parent_conversation_id) REFERENCES conversations(id),
        FOREIGN KEY (root_conversation_id) REFERENCES conversations(id)
      ) STRICT;

      CREATE INDEX conversations_workspace_created_idx
      ON conversations(workspace_id, created_at, id);

      CREATE INDEX conversations_root_created_idx
      ON conversations(root_conversation_id, created_at, id);

      CREATE INDEX conversations_parent_created_idx
      ON conversations(parent_conversation_id, created_at, id);

      CREATE TABLE conversation_agent_bindings (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        agent_type TEXT NOT NULL,
        definition_version TEXT NOT NULL,
        manifest_digest TEXT,
        status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'detached')),
        created_at TEXT NOT NULL,
        superseded_at TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        UNIQUE (conversation_id, revision)
      ) STRICT;

      CREATE UNIQUE INDEX conversation_agent_bindings_one_active_idx
      ON conversation_agent_bindings(conversation_id)
      WHERE status = 'active';

      CREATE INDEX conversation_agent_bindings_type_version_idx
      ON conversation_agent_bindings(agent_type, definition_version);
    `,
  },
  {
    version: 2,
    name: "conversation_journal",
    sql: `
      CREATE TABLE journal_records (
        conversation_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        event_id TEXT NOT NULL,
        event_direction TEXT NOT NULL CHECK (event_direction IN ('input', 'output')),
        event_type TEXT NOT NULL,
        schema_version INTEGER NOT NULL CHECK (schema_version > 0),
        event_timestamp TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        run_id TEXT,
        turn_id TEXT,
        correlation_id TEXT,
        causation_id TEXT,
        event_json TEXT NOT NULL,
        event_hash TEXT NOT NULL,
        PRIMARY KEY (conversation_id, sequence),
        UNIQUE (conversation_id, event_id),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX journal_records_direction_sequence_idx
      ON journal_records(conversation_id, event_direction, sequence);

      CREATE INDEX journal_records_type_sequence_idx
      ON journal_records(conversation_id, event_type, sequence);

      CREATE INDEX journal_records_run_sequence_idx
      ON journal_records(conversation_id, run_id, sequence);

      CREATE INDEX journal_records_turn_sequence_idx
      ON journal_records(conversation_id, turn_id, sequence);
    `,
  },
  {
    version: 3,
    name: "subagent_bindings",
    sql: `
      CREATE TABLE subagent_bindings (
        subagent_id TEXT PRIMARY KEY,
        parent_conversation_id TEXT NOT NULL,
        parent_run_id TEXT NOT NULL,
        child_conversation_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('creating', 'running', 'completed', 'failed', 'cancelled', 'orphaned')),
        binding_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (parent_conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (child_conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX subagent_bindings_parent_run_idx
      ON subagent_bindings(parent_conversation_id, parent_run_id, status, updated_at, subagent_id);

      CREATE TABLE subagent_binding_changes (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        subagent_id TEXT NOT NULL,
        binding_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        FOREIGN KEY (subagent_id) REFERENCES subagent_bindings(subagent_id) ON DELETE CASCADE
      ) STRICT;
    `,
  },
  {
    version: 4,
    name: "conversation_agent_manifest_identity",
    sql: `
      ALTER TABLE conversation_agent_bindings
      ADD COLUMN manifest_id TEXT;
    `,
  },
  {
    version: 5,
    name: "agent_manifests",
    sql: `
      CREATE TABLE agent_manifests (
        manifest_id TEXT PRIMARY KEY,
        manifest_digest TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        definition_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        manifest_json TEXT NOT NULL
      ) STRICT;

      CREATE INDEX agent_manifests_type_version_created_idx
      ON agent_manifests(agent_type, definition_version, created_at, manifest_id);
    `,
  },
  {
    version: 6,
    name: "conversation_title_and_pinned",
    sql: `
      ALTER TABLE conversations ADD COLUMN title TEXT NOT NULL DEFAULT '';
      ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 7,
    name: "conversation_mode",
    sql: `
      ALTER TABLE conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'review';
      CREATE TABLE conversation_compose_state (
        conversation_id   TEXT PRIMARY KEY,
        phase             TEXT NOT NULL CHECK (phase IN ('designing', 'pending')),
        design_file_path  TEXT NOT NULL,
        pre_mode          TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      ) STRICT;
    `,
  },
  {
    version: 8,
    name: "conversation_compose_purpose",
    sql: `
      ALTER TABLE conversation_compose_state ADD COLUMN purpose TEXT;
    `,
  },
];

export function runCoreSqliteMigrations(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const appliedRows = database.prepare("SELECT version FROM schema_migrations").all() as Array<{
    version: number;
  }>;
  const appliedVersions = new Set(appliedRows.map((row) => row.version));
  const insertMigration = database.prepare(
    "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
  );

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      insertMigration.run(migration.version, migration.name, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
