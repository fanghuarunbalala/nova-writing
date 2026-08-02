/** Shared Character and Location tables used by canonical and Draft migrations. */

export const NOVEL_ENTITY_SCHEMA_SQL = `
  CREATE TABLE novel_characters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    aliases_json TEXT NOT NULL,
    summary TEXT,
    initial_state TEXT,
    author_notes TEXT,
    entity_version INTEGER NOT NULL CHECK (entity_version > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX novel_characters_name_idx
  ON novel_characters(name, id);

  CREATE TABLE novel_locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    aliases_json TEXT NOT NULL,
    summary TEXT,
    initial_state TEXT,
    author_notes TEXT,
    entity_version INTEGER NOT NULL CHECK (entity_version > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX novel_locations_name_idx
  ON novel_locations(name, id);
`;
