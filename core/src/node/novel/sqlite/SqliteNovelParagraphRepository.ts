/** SQLite-backed transaction-local Paragraph repository with digest validation. */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonicalStringifyJson } from "../../../event/index.js";
import {
  captureOrderKey,
  captureParagraph,
  captureParagraphId,
  captureStoryUnitId,
  type NovelMutableParagraphRepository,
  type NovelParagraphMutationContext,
  type Paragraph,
  type ParagraphDigestField,
} from "../../../novel/index.js";

interface ParagraphRow {
  id: string;
  story_unit_id: string;
  order_key: string;
  text: string;
  text_digest: string;
  order_digest: string;
  story_unit_digest: string;
}

const PARAGRAPH_SELECT = `SELECT id, story_unit_id, order_key, text,
  text_digest, order_digest, story_unit_digest FROM novel_paragraphs`;

export function createSqliteNovelParagraphMutationContext(
  database: DatabaseSync,
): NovelParagraphMutationContext {
  return Object.freeze({
    paragraph: new SqliteNovelParagraphRepository(database),
  });
}

export class SqliteNovelParagraphRepository
  implements NovelMutableParagraphRepository
{
  constructor(private readonly database: DatabaseSync) {}

  getParagraph(id: Paragraph["id"]): Paragraph | undefined {
    const row = this.database
      .prepare(`${PARAGRAPH_SELECT} WHERE id = ?`)
      .get(captureParagraphId(id)) as ParagraphRow | undefined;
    return row === undefined ? undefined : decodeParagraph(row);
  }

  listAllParagraphs(): readonly Paragraph[] {
    const rows = this.database
      .prepare(`${PARAGRAPH_SELECT} ORDER BY story_unit_id, order_key, id`)
      .all() as unknown as ParagraphRow[];
    return Object.freeze(rows.map(decodeParagraph));
  }

  listParagraphsByStoryUnit(
    storyUnitId: Paragraph["storyUnitId"],
  ): readonly Paragraph[] {
    const rows = this.database
      .prepare(
        `${PARAGRAPH_SELECT}
         WHERE story_unit_id = ? ORDER BY order_key, id`,
      )
      .all(captureStoryUnitId(storyUnitId)) as unknown as ParagraphRow[];
    return Object.freeze(rows.map(decodeParagraph));
  }

  findParagraphAt(
    storyUnitId: Paragraph["storyUnitId"],
    orderKey: Paragraph["orderKey"],
  ): Paragraph | undefined {
    const row = this.database
      .prepare(
        `${PARAGRAPH_SELECT}
         WHERE story_unit_id = ? AND order_key = ?`,
      )
      .get(
        captureStoryUnitId(storyUnitId),
        captureOrderKey(orderKey),
      ) as ParagraphRow | undefined;
    return row === undefined ? undefined : decodeParagraph(row);
  }

  getParagraphDigest(
    id: Paragraph["id"],
    field: ParagraphDigestField,
  ): string | undefined {
    const column = field === "text"
      ? "text_digest"
      : field === "orderKey"
      ? "order_digest"
      : "story_unit_digest";
    const row = this.database
      .prepare(`SELECT ${column} AS digest FROM novel_paragraphs WHERE id = ?`)
      .get(captureParagraphId(id)) as { digest: string } | undefined;
    return row?.digest;
  }

  insertParagraph(paragraph: Paragraph): boolean {
    const encoded = encodeParagraph(paragraph);
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO novel_paragraphs(
           id, story_unit_id, order_key, text,
           text_digest, order_digest, story_unit_digest
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...encoded);
    return Number(result.changes) === 1;
  }

  replaceParagraph(paragraph: Paragraph): boolean {
    const encoded = encodeParagraph(paragraph);
    const result = this.database
      .prepare(
        `UPDATE novel_paragraphs
         SET story_unit_id = ?, order_key = ?, text = ?,
             text_digest = ?, order_digest = ?, story_unit_digest = ?
         WHERE id = ?`,
      )
      .run(
        encoded[1],
        encoded[2],
        encoded[3],
        encoded[4],
        encoded[5],
        encoded[6],
        encoded[0],
      );
    return Number(result.changes) === 1;
  }

  deleteParagraph(id: Paragraph["id"]): boolean {
    const result = this.database
      .prepare("DELETE FROM novel_paragraphs WHERE id = ?")
      .run(captureParagraphId(id));
    return Number(result.changes) === 1;
  }

  removeParagraphFromChapters(paragraphId: Paragraph["id"]): boolean {
    this.database
      .prepare("DELETE FROM novel_chapter_paragraphs WHERE paragraph_id = ?")
      .run(captureParagraphId(paragraphId));
    return true;
  }

  hasStoryUnit(storyUnitId: Paragraph["storyUnitId"]): boolean {
    const row = this.database
      .prepare("SELECT 1 AS present FROM novel_story_units WHERE id = ? LIMIT 1")
      .get(captureStoryUnitId(storyUnitId)) as { present: number } | undefined;
    return row !== undefined;
  }
}

function decodeParagraph(row: ParagraphRow): Paragraph {
  const paragraph = captureParagraph({
    id: row.id,
    storyUnitId: row.story_unit_id,
    orderKey: row.order_key,
    text: row.text,
  });
  const encoded = encodeParagraph(paragraph);
  if (
    encoded[4] !== row.text_digest ||
    encoded[5] !== row.order_digest ||
    encoded[6] !== row.story_unit_digest
  ) {
    throw new Error();
  }
  return paragraph;
}

function encodeParagraph(paragraph: Paragraph): readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
] {
  const value = captureParagraph(paragraph);
  return [
    value.id,
    value.storyUnitId,
    value.orderKey,
    value.text,
    digest(value.text),
    digest(value.orderKey),
    digest(value.storyUnitId),
  ];
}

function digest(value: string): string {
  return createHash("sha256")
    .update(canonicalStringifyJson(value as never))
    .digest("hex");
}
