/** Shared canonical and Draft SQLite schema for accepted Story Outline state. */
export const NOVEL_OUTLINE_SCHEMA_SQL = `
  CREATE TABLE novel_story_outlines (
    id TEXT PRIMARY KEY,
    novel_id TEXT NOT NULL UNIQUE
  ) STRICT;

  CREATE TABLE novel_story_units (
    id TEXT PRIMARY KEY,
    outline_id TEXT NOT NULL,
    parent_id TEXT,
    order_key TEXT NOT NULL,
    content_json TEXT NOT NULL,
    content_digest TEXT NOT NULL CHECK (length(content_digest) = 64),
    parent_digest TEXT NOT NULL CHECK (length(parent_digest) = 64),
    order_digest TEXT NOT NULL CHECK (length(order_digest) = 64),
    FOREIGN KEY (outline_id) REFERENCES novel_story_outlines(id),
    FOREIGN KEY (parent_id) REFERENCES novel_story_units(id)
  ) STRICT;

  CREATE UNIQUE INDEX novel_story_units_root_order_idx
  ON novel_story_units(outline_id, order_key)
  WHERE parent_id IS NULL;

  CREATE UNIQUE INDEX novel_story_units_child_order_idx
  ON novel_story_units(outline_id, parent_id, order_key)
  WHERE parent_id IS NOT NULL;

  CREATE INDEX novel_story_units_parent_order_idx
  ON novel_story_units(outline_id, parent_id, order_key, id);

  CREATE TABLE novel_leaf_story_unit_plans (
    story_unit_id TEXT PRIMARY KEY,
    plan_json TEXT NOT NULL,
    plan_digest TEXT NOT NULL CHECK (length(plan_digest) = 64),
    FOREIGN KEY (story_unit_id) REFERENCES novel_story_units(id)
  ) STRICT;
`;
