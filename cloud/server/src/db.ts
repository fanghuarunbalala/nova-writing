import Database from "better-sqlite3";

/**
 * server 端数据层：档位 1（单实例 SQLite WAL）。
 * 关键设计：域表写与账本 append 在同一事务（PRD FR3）——消除「域数据变了但账本没记」的窗口，
 * 账本天然是可重放的变更流。
 */
export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 3000");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      refresh_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_family ON sessions(family_id);

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS journal_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      run_seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      definition_version TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_journal_conv ON journal_events(conversation_id, seq);

    CREATE TABLE IF NOT EXISTS leases (
      conversation_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paragraphs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      story_unit_id TEXT NOT NULL,
      order_key INTEGER NOT NULL,
      entity_version INTEGER NOT NULL DEFAULT 1,
      text TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL UNIQUE,
      conversation_id TEXT NOT NULL,
      run_seq INTEGER NOT NULL,
      calls_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      comment TEXT,
      proposed_json TEXT,
      decided_by TEXT,
      created_at INTEGER NOT NULL,
      decided_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS project_files (
      project_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, path)
    );

    CREATE TABLE IF NOT EXISTS definitions (
      definition_version TEXT PRIMARY KEY,
      agent_type TEXT NOT NULL,
      content TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      requires_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

export type Db = Database.Database;
