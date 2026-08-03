/** Shared canonical and Draft SQLite schema for authoritative projection evidence. */
export const NOVEL_PROJECTION_EVIDENCE_SCHEMA_SQL = `
  CREATE TABLE novel_story_unit_character_bindings (
    story_unit_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    binding_json TEXT NOT NULL,
    binding_digest TEXT NOT NULL CHECK (length(binding_digest) = 64),
    PRIMARY KEY (story_unit_id, character_id),
    FOREIGN KEY (story_unit_id) REFERENCES novel_story_units(id),
    FOREIGN KEY (character_id) REFERENCES novel_characters(id)
  ) STRICT;

  CREATE TABLE novel_story_unit_location_bindings (
    story_unit_id TEXT NOT NULL,
    location_id TEXT NOT NULL,
    binding_json TEXT NOT NULL,
    binding_digest TEXT NOT NULL CHECK (length(binding_digest) = 64),
    PRIMARY KEY (story_unit_id, location_id),
    FOREIGN KEY (story_unit_id) REFERENCES novel_story_units(id),
    FOREIGN KEY (location_id) REFERENCES novel_locations(id)
  ) STRICT;

  CREATE TABLE novel_story_unit_entity_changes (
    id TEXT PRIMARY KEY,
    story_unit_id TEXT NOT NULL,
    change_json TEXT NOT NULL,
    change_digest TEXT NOT NULL CHECK (length(change_digest) = 64),
    FOREIGN KEY (story_unit_id) REFERENCES novel_story_units(id)
  ) STRICT;

  CREATE INDEX novel_story_unit_entity_changes_unit_idx
  ON novel_story_unit_entity_changes(story_unit_id, id);

  CREATE TABLE novel_story_unit_realizations (
    story_unit_id TEXT PRIMARY KEY,
    realization_json TEXT NOT NULL,
    realization_digest TEXT NOT NULL CHECK (length(realization_digest) = 64),
    FOREIGN KEY (story_unit_id) REFERENCES novel_story_units(id)
  ) STRICT;
`;
