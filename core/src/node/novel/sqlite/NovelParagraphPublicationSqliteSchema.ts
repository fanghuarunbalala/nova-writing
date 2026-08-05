/** Shared canonical and Draft SQLite schema for Paragraph and Publication state. */
export const NOVEL_PARAGRAPH_PUBLICATION_SCHEMA_SQL = `
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
    FOREIGN KEY (publication_id) REFERENCES novel_publication_structures(id)
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

  CREATE TABLE novel_paragraphs (
    id TEXT PRIMARY KEY,
    story_unit_id TEXT NOT NULL,
    order_key TEXT NOT NULL,
    text TEXT NOT NULL,
    text_digest TEXT NOT NULL CHECK (length(text_digest) = 64),
    order_digest TEXT NOT NULL CHECK (length(order_digest) = 64),
    story_unit_digest TEXT NOT NULL CHECK (length(story_unit_digest) = 64),
    FOREIGN KEY (story_unit_id) REFERENCES novel_story_units(id)
  ) STRICT;

  CREATE UNIQUE INDEX novel_paragraphs_order_idx
  ON novel_paragraphs(story_unit_id, order_key);

  CREATE TABLE novel_chapter_paragraphs (
    chapter_id TEXT NOT NULL,
    paragraph_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (chapter_id, paragraph_id),
    UNIQUE (chapter_id, position),
    FOREIGN KEY (chapter_id) REFERENCES novel_publication_chapters(id),
    FOREIGN KEY (paragraph_id) REFERENCES novel_paragraphs(id)
  ) STRICT;
`;
