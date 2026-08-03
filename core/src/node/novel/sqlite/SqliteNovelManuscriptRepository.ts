/** SQLite-backed transaction-local Manuscript repository with digest validation. */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonicalStringifyJson } from "../../../event/index.js";
import {
  captureManuscript,
  captureManuscriptAnchor,
  captureManuscriptAnchorRedirect,
  captureManuscriptBlockId,
  captureManuscriptBlockTombstone,
  captureManuscriptId,
  captureNovelId,
  captureOrderKey,
  captureParagraphBlock,
  capturePublicationChapterId,
  manuscriptAnchorKey,
  type Manuscript,
  type ManuscriptAnchor,
  type ManuscriptAnchorRedirect,
  type ManuscriptBlockDigestField,
  type ManuscriptBlockTombstone,
  type NovelManuscriptMutationContext,
  type NovelMutableManuscriptRepository,
  type ParagraphBlock,
} from "../../../novel/index.js";

interface ManuscriptRow {
  id: string;
  novel_id: string;
  publication_id: string;
}

interface BlockRow {
  id: string;
  manuscript_id: string;
  chapter_id: string;
  order_key: string;
  text: string;
  text_digest: string;
  chapter_digest: string;
  order_digest: string;
}

interface TombstoneRow {
  block_id: string;
  manuscript_id: string;
  former_chapter_id: string;
  former_order_key: string;
  reason: string;
  replacement_block_id: string | null;
}

interface RedirectRow {
  source_block_id: string;
  source_boundary: string;
  target_block_id: string;
  target_boundary: string;
  reason: string;
  review: string;
}

const BLOCK_SELECT = `SELECT id, manuscript_id, chapter_id, order_key, text,
  text_digest, chapter_digest, order_digest FROM novel_manuscript_blocks`;

export function createSqliteNovelManuscriptMutationContext(
  database: DatabaseSync,
): NovelManuscriptMutationContext {
  return Object.freeze({
    manuscript: new SqliteNovelManuscriptRepository(database),
  });
}

export class SqliteNovelManuscriptRepository
  implements NovelMutableManuscriptRepository
{
  constructor(private readonly database: DatabaseSync) {}

  getManuscript(id: Manuscript["id"]): Manuscript | undefined {
    const row = this.database
      .prepare("SELECT id, novel_id, publication_id FROM novel_manuscripts WHERE id = ?")
      .get(captureManuscriptId(id)) as ManuscriptRow | undefined;
    return row === undefined ? undefined : decodeManuscript(row);
  }

  findManuscriptByNovelId(novelId: Manuscript["novelId"]): Manuscript | undefined {
    const row = this.database
      .prepare("SELECT id, novel_id, publication_id FROM novel_manuscripts WHERE novel_id = ?")
      .get(captureNovelId(novelId)) as ManuscriptRow | undefined;
    return row === undefined ? undefined : decodeManuscript(row);
  }

  insertManuscript(manuscript: Manuscript): boolean {
    const value = captureManuscript(manuscript);
    const result = this.database
      .prepare(
        "INSERT OR IGNORE INTO novel_manuscripts(id, novel_id, publication_id) VALUES (?, ?, ?)",
      )
      .run(value.id, value.novelId, value.publicationId);
    return Number(result.changes) === 1;
  }

  getBlock(id: ParagraphBlock["id"]): ParagraphBlock | undefined {
    const row = this.database
      .prepare(`${BLOCK_SELECT} WHERE id = ?`)
      .get(captureManuscriptBlockId(id)) as BlockRow | undefined;
    return row === undefined ? undefined : decodeBlock(row);
  }

  listBlocks(
    manuscriptId: ParagraphBlock["manuscriptId"],
  ): readonly ParagraphBlock[] {
    const rows = this.database
      .prepare(
        `${BLOCK_SELECT}
         WHERE manuscript_id = ? ORDER BY chapter_id, order_key, id`,
      )
      .all(captureManuscriptId(manuscriptId)) as unknown as BlockRow[];
    return Object.freeze(rows.map(decodeBlock));
  }

  getBlockDigest(
    id: ParagraphBlock["id"],
    field: ManuscriptBlockDigestField,
  ): string | undefined {
    const column = field === "text"
      ? "text_digest"
      : field === "chapterId"
      ? "chapter_digest"
      : "order_digest";
    const row = this.database
      .prepare(`SELECT ${column} AS digest FROM novel_manuscript_blocks WHERE id = ?`)
      .get(captureManuscriptBlockId(id)) as { digest: string } | undefined;
    return row?.digest;
  }

  listBlocksInChapter(
    manuscriptId: ParagraphBlock["manuscriptId"],
    chapterId: ParagraphBlock["chapterId"],
  ): readonly ParagraphBlock[] {
    const rows = this.database
      .prepare(
        `${BLOCK_SELECT}
         WHERE manuscript_id = ? AND chapter_id = ? ORDER BY order_key, id`,
      )
      .all(
        captureManuscriptId(manuscriptId),
        capturePublicationChapterId(chapterId),
      ) as unknown as BlockRow[];
    return Object.freeze(rows.map(decodeBlock));
  }

  findBlockAt(
    manuscriptId: ParagraphBlock["manuscriptId"],
    chapterId: ParagraphBlock["chapterId"],
    orderKey: ParagraphBlock["orderKey"],
  ): ParagraphBlock | undefined {
    const row = this.database
      .prepare(
        `${BLOCK_SELECT}
         WHERE manuscript_id = ? AND chapter_id = ? AND order_key = ?`,
      )
      .get(
        captureManuscriptId(manuscriptId),
        capturePublicationChapterId(chapterId),
        captureOrderKey(orderKey),
      ) as BlockRow | undefined;
    return row === undefined ? undefined : decodeBlock(row);
  }

  hasPublicationChapter(chapterId: ParagraphBlock["chapterId"]): boolean {
    const row = this.database
      .prepare("SELECT 1 AS present FROM novel_publication_chapters WHERE id = ? LIMIT 1")
      .get(capturePublicationChapterId(chapterId)) as { present: number } | undefined;
    return row !== undefined;
  }

  insertBlock(block: ParagraphBlock): boolean {
    const encoded = encodeBlock(block);
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO novel_manuscript_blocks(
           id, manuscript_id, chapter_id, order_key, text,
           text_digest, chapter_digest, order_digest
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...encoded);
    return Number(result.changes) === 1;
  }

  replaceBlock(block: ParagraphBlock): boolean {
    const encoded = encodeBlock(block);
    const result = this.database
      .prepare(
        `UPDATE novel_manuscript_blocks
         SET manuscript_id = ?, chapter_id = ?, order_key = ?, text = ?,
             text_digest = ?, chapter_digest = ?, order_digest = ?
         WHERE id = ?`,
      )
      .run(
        encoded[1],
        encoded[2],
        encoded[3],
        encoded[4],
        encoded[5],
        encoded[6],
        encoded[7],
        encoded[0],
      );
    return Number(result.changes) === 1;
  }

  deleteBlock(id: ParagraphBlock["id"]): boolean {
    const result = this.database
      .prepare("DELETE FROM novel_manuscript_blocks WHERE id = ?")
      .run(captureManuscriptBlockId(id));
    return Number(result.changes) === 1;
  }

  getTombstone(id: ParagraphBlock["id"]): ManuscriptBlockTombstone | undefined {
    const row = this.database
      .prepare(
        `SELECT block_id, manuscript_id, former_chapter_id, former_order_key,
                reason, replacement_block_id
         FROM novel_manuscript_block_tombstones WHERE block_id = ?`,
      )
      .get(captureManuscriptBlockId(id)) as TombstoneRow | undefined;
    return row === undefined ? undefined : decodeTombstone(row);
  }

  listTombstones(
    manuscriptId: ManuscriptBlockTombstone["manuscriptId"],
  ): readonly ManuscriptBlockTombstone[] {
    const rows = this.database.prepare(
      `SELECT block_id, manuscript_id, former_chapter_id, former_order_key,
              reason, replacement_block_id
       FROM novel_manuscript_block_tombstones
       WHERE manuscript_id = ? ORDER BY block_id`,
    ).all(captureManuscriptId(manuscriptId)) as unknown as TombstoneRow[];
    return Object.freeze(rows.map(decodeTombstone));
  }

  insertTombstone(tombstone: ManuscriptBlockTombstone): boolean {
    const value = captureManuscriptBlockTombstone(tombstone);
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO novel_manuscript_block_tombstones(
           block_id, manuscript_id, former_chapter_id, former_order_key,
           reason, replacement_block_id
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.blockId,
        value.manuscriptId,
        value.formerChapterId,
        value.formerOrderKey,
        value.reason,
        value.replacementBlockId ?? null,
      );
    return Number(result.changes) === 1;
  }

  getAnchorRedirect(source: ManuscriptAnchor): ManuscriptAnchorRedirect | undefined {
    const anchor = captureManuscriptAnchor(source);
    const row = this.database
      .prepare(
        `SELECT source_block_id, source_boundary, target_block_id,
                target_boundary, reason, review
         FROM novel_manuscript_anchor_redirects
         WHERE source_block_id = ? AND source_boundary = ?`,
      )
      .get(anchor.blockId, anchor.boundary) as RedirectRow | undefined;
    return row === undefined ? undefined : decodeRedirect(row);
  }

  listAnchorRedirects(): readonly ManuscriptAnchorRedirect[] {
    const rows = this.database.prepare(
      `SELECT source_block_id, source_boundary, target_block_id,
              target_boundary, reason, review
       FROM novel_manuscript_anchor_redirects
       ORDER BY source_block_id, source_boundary`,
    ).all() as unknown as RedirectRow[];
    return Object.freeze(rows.map(decodeRedirect));
  }

  insertAnchorRedirect(redirect: ManuscriptAnchorRedirect): boolean {
    const value = captureManuscriptAnchorRedirect(redirect);
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO novel_manuscript_anchor_redirects(
           source_block_id, source_boundary, target_block_id, target_boundary,
           reason, review
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.source.blockId,
        value.source.boundary,
        value.target.blockId,
        value.target.boundary,
        value.reason,
        value.review,
      );
    return Number(result.changes) === 1;
  }
}

function decodeManuscript(row: ManuscriptRow): Manuscript {
  return captureManuscript({
    id: row.id,
    novelId: row.novel_id,
    publicationId: row.publication_id,
  });
}

function decodeBlock(row: BlockRow): ParagraphBlock {
  const block = captureParagraphBlock({
    id: row.id,
    manuscriptId: row.manuscript_id,
    chapterId: row.chapter_id,
    orderKey: row.order_key,
    text: row.text,
  });
  const encoded = encodeBlock(block);
  if (
    encoded[5] !== row.text_digest ||
    encoded[6] !== row.chapter_digest ||
    encoded[7] !== row.order_digest
  ) {
    throw new Error();
  }
  return block;
}

function encodeBlock(block: ParagraphBlock): readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
] {
  const value = captureParagraphBlock(block);
  return [
    value.id,
    value.manuscriptId,
    value.chapterId,
    value.orderKey,
    value.text,
    digest(value.text),
    digest(value.chapterId),
    digest(value.orderKey),
  ];
}

function decodeTombstone(row: TombstoneRow): ManuscriptBlockTombstone {
  return captureManuscriptBlockTombstone({
    blockId: row.block_id,
    manuscriptId: row.manuscript_id,
    formerChapterId: row.former_chapter_id,
    formerOrderKey: row.former_order_key,
    reason: row.reason,
    ...(row.replacement_block_id === null
      ? {}
      : { replacementBlockId: row.replacement_block_id }),
  });
}

function decodeRedirect(row: RedirectRow): ManuscriptAnchorRedirect {
  const redirect = captureManuscriptAnchorRedirect({
    source: {
      blockId: row.source_block_id,
      boundary: row.source_boundary,
    },
    target: {
      blockId: row.target_block_id,
      boundary: row.target_boundary,
    },
    reason: row.reason,
    review: row.review,
  });
  manuscriptAnchorKey(redirect.source);
  return redirect;
}

function digest(value: string): string {
  return createHash("sha256")
    .update(canonicalStringifyJson(value as never))
    .digest("hex");
}
