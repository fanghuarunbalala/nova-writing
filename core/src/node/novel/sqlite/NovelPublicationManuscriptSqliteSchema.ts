/** Shared canonical and Draft SQLite schema for Publication and Manuscript state. */
export const NOVEL_PUBLICATION_MANUSCRIPT_SCHEMA_SQL = `
  CREATE TABLE novel_publication_structures (
    id TEXT PRIMARY KEY,
    novel_id TEXT NOT NULL UNIQUE,
    FOREIGN KEY (novel_id) REFERENCES novel_metadata(novel_id)
  ) STRICT;

  CREATE TABLE novel_publication_volumes (
    id TEXT PRIMARY KEY,
    publication_id TEXT NOT NULL,
    order_key TEXT NOT NULL,
    title TEXT NOT NULL,
    primary_story_unit_id TEXT,
    FOREIGN KEY (publication_id) REFERENCES novel_publication_structures(id),
    FOREIGN KEY (primary_story_unit_id) REFERENCES novel_story_units(id)
  ) STRICT;

  CREATE UNIQUE INDEX novel_publication_volumes_order_idx
  ON novel_publication_volumes(publication_id, order_key);

  CREATE UNIQUE INDEX novel_publication_volumes_identity_idx
  ON novel_publication_volumes(id, publication_id);

  CREATE TABLE novel_publication_chapters (
    id TEXT PRIMARY KEY,
    publication_id TEXT NOT NULL,
    volume_id TEXT NOT NULL,
    order_key TEXT NOT NULL,
    title TEXT NOT NULL,
    FOREIGN KEY (publication_id) REFERENCES novel_publication_structures(id),
    FOREIGN KEY (volume_id, publication_id)
      REFERENCES novel_publication_volumes(id, publication_id)
  ) STRICT;

  CREATE UNIQUE INDEX novel_publication_chapters_order_idx
  ON novel_publication_chapters(volume_id, order_key);

  CREATE UNIQUE INDEX novel_publication_chapters_identity_idx
  ON novel_publication_chapters(id, publication_id);

  CREATE TABLE novel_manuscripts (
    id TEXT PRIMARY KEY,
    novel_id TEXT NOT NULL UNIQUE,
    publication_id TEXT NOT NULL UNIQUE,
    FOREIGN KEY (novel_id) REFERENCES novel_metadata(novel_id),
    FOREIGN KEY (publication_id) REFERENCES novel_publication_structures(id)
  ) STRICT;

  CREATE TABLE novel_manuscript_blocks (
    id TEXT PRIMARY KEY,
    manuscript_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    order_key TEXT NOT NULL,
    text TEXT NOT NULL,
    text_digest TEXT NOT NULL CHECK (length(text_digest) = 64),
    chapter_digest TEXT NOT NULL CHECK (length(chapter_digest) = 64),
    order_digest TEXT NOT NULL CHECK (length(order_digest) = 64),
    FOREIGN KEY (manuscript_id) REFERENCES novel_manuscripts(id),
    FOREIGN KEY (chapter_id) REFERENCES novel_publication_chapters(id)
  ) STRICT;

  CREATE UNIQUE INDEX novel_manuscript_blocks_order_idx
  ON novel_manuscript_blocks(manuscript_id, chapter_id, order_key);

  CREATE TABLE novel_manuscript_block_tombstones (
    block_id TEXT PRIMARY KEY,
    manuscript_id TEXT NOT NULL,
    former_chapter_id TEXT NOT NULL,
    former_order_key TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('deleted', 'merged')),
    replacement_block_id TEXT,
    FOREIGN KEY (manuscript_id) REFERENCES novel_manuscripts(id),
    FOREIGN KEY (former_chapter_id) REFERENCES novel_publication_chapters(id)
  ) STRICT;

  CREATE TABLE novel_manuscript_anchor_redirects (
    source_block_id TEXT NOT NULL,
    source_boundary TEXT NOT NULL CHECK (source_boundary IN ('before', 'after')),
    target_block_id TEXT NOT NULL,
    target_boundary TEXT NOT NULL CHECK (target_boundary IN ('before', 'after')),
    reason TEXT NOT NULL CHECK (reason IN ('split', 'merge', 'manual-repair')),
    review TEXT NOT NULL CHECK (review IN ('automatic', 'review-required')),
    PRIMARY KEY (source_block_id, source_boundary)
  ) STRICT;
`;
