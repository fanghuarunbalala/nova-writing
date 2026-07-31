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
