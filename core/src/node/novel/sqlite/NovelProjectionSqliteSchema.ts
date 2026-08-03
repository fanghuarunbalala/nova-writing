/** Shared canonical and Draft SQLite schema for disposable Novel projection caches. */
export const NOVEL_PROJECTION_CACHE_SCHEMA_SQL = `
  CREATE TABLE novel_projection_cache (
    projection_key TEXT PRIMARY KEY,
    target_json TEXT NOT NULL,
    projection_json TEXT NOT NULL,
    projection_digest TEXT NOT NULL,
    rebuild_revision TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX novel_projection_cache_revision_idx
  ON novel_projection_cache(rebuild_revision, projection_key);
`;
