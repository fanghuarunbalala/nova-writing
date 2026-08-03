/** SQLite-backed transaction-local Publication repository. */
import type { DatabaseSync } from "node:sqlite";
import {
  captureNovelId,
  captureOrderKey,
  capturePublicationChapter,
  capturePublicationChapterId,
  capturePublicationStructure,
  capturePublicationStructureId,
  capturePublicationVolume,
  capturePublicationVolumeId,
  type NovelMutablePublicationRepository,
  type NovelPublicationMutationContext,
  type PublicationChapter,
  type PublicationStructure,
  type PublicationVolume,
} from "../../../novel/index.js";

interface PublicationRow {
  id: string;
  novel_id: string;
}

interface VolumeRow {
  id: string;
  publication_id: string;
  order_key: string;
  title: string;
  primary_story_unit_id: string | null;
}

interface ChapterRow {
  id: string;
  publication_id: string;
  volume_id: string;
  order_key: string;
  title: string;
}

const VOLUME_SELECT = `SELECT id, publication_id, order_key, title,
  primary_story_unit_id FROM novel_publication_volumes`;
const CHAPTER_SELECT = `SELECT id, publication_id, volume_id, order_key, title
  FROM novel_publication_chapters`;

export function createSqliteNovelPublicationMutationContext(
  database: DatabaseSync,
): NovelPublicationMutationContext {
  return Object.freeze({
    publication: new SqliteNovelPublicationRepository(database),
  });
}

export class SqliteNovelPublicationRepository
  implements NovelMutablePublicationRepository
{
  constructor(private readonly database: DatabaseSync) {}

  getPublication(id: PublicationStructure["id"]): PublicationStructure | undefined {
    const row = this.database
      .prepare("SELECT id, novel_id FROM novel_publication_structures WHERE id = ?")
      .get(capturePublicationStructureId(id)) as PublicationRow | undefined;
    return row === undefined ? undefined : decodePublication(row);
  }

  findPublicationByNovelId(
    novelId: PublicationStructure["novelId"],
  ): PublicationStructure | undefined {
    const row = this.database
      .prepare("SELECT id, novel_id FROM novel_publication_structures WHERE novel_id = ?")
      .get(captureNovelId(novelId)) as PublicationRow | undefined;
    return row === undefined ? undefined : decodePublication(row);
  }

  insertPublication(publication: PublicationStructure): boolean {
    const value = capturePublicationStructure(publication);
    const result = this.database
      .prepare("INSERT OR IGNORE INTO novel_publication_structures(id, novel_id) VALUES (?, ?)")
      .run(value.id, value.novelId);
    return Number(result.changes) === 1;
  }

  getVolume(id: PublicationVolume["id"]): PublicationVolume | undefined {
    const row = this.database
      .prepare(`${VOLUME_SELECT} WHERE id = ?`)
      .get(capturePublicationVolumeId(id)) as VolumeRow | undefined;
    return row === undefined ? undefined : decodeVolume(row);
  }

  listVolumes(publicationId: PublicationVolume["publicationId"]): readonly PublicationVolume[] {
    const rows = this.database
      .prepare(`${VOLUME_SELECT} WHERE publication_id = ? ORDER BY order_key, id`)
      .all(capturePublicationStructureId(publicationId)) as unknown as VolumeRow[];
    return Object.freeze(rows.map(decodeVolume));
  }

  findVolumeAt(
    publicationId: PublicationVolume["publicationId"],
    orderKey: PublicationVolume["orderKey"],
  ): PublicationVolume | undefined {
    const row = this.database
      .prepare(`${VOLUME_SELECT} WHERE publication_id = ? AND order_key = ?`)
      .get(
        capturePublicationStructureId(publicationId),
        captureOrderKey(orderKey),
      ) as VolumeRow | undefined;
    return row === undefined ? undefined : decodeVolume(row);
  }

  insertVolume(volume: PublicationVolume): boolean {
    const value = capturePublicationVolume(volume);
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO novel_publication_volumes(
           id, publication_id, order_key, title, primary_story_unit_id
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.publicationId,
        value.orderKey,
        value.title,
        value.primaryStoryUnitId ?? null,
      );
    return Number(result.changes) === 1;
  }

  replaceVolume(volume: PublicationVolume): boolean {
    const value = capturePublicationVolume(volume);
    const result = this.database
      .prepare(
        `UPDATE novel_publication_volumes
         SET publication_id = ?, order_key = ?, title = ?, primary_story_unit_id = ?
         WHERE id = ?`,
      )
      .run(
        value.publicationId,
        value.orderKey,
        value.title,
        value.primaryStoryUnitId ?? null,
        value.id,
      );
    return Number(result.changes) === 1;
  }

  deleteVolume(id: PublicationVolume["id"]): boolean {
    const result = this.database
      .prepare("DELETE FROM novel_publication_volumes WHERE id = ?")
      .run(capturePublicationVolumeId(id));
    return Number(result.changes) === 1;
  }

  getChapter(id: PublicationChapter["id"]): PublicationChapter | undefined {
    const row = this.database
      .prepare(`${CHAPTER_SELECT} WHERE id = ?`)
      .get(capturePublicationChapterId(id)) as ChapterRow | undefined;
    return row === undefined ? undefined : decodeChapter(row);
  }

  listChapters(volumeId: PublicationChapter["volumeId"]): readonly PublicationChapter[] {
    const rows = this.database
      .prepare(`${CHAPTER_SELECT} WHERE volume_id = ? ORDER BY order_key, id`)
      .all(capturePublicationVolumeId(volumeId)) as unknown as ChapterRow[];
    return Object.freeze(rows.map(decodeChapter));
  }

  findChapterAt(
    volumeId: PublicationChapter["volumeId"],
    orderKey: PublicationChapter["orderKey"],
  ): PublicationChapter | undefined {
    const row = this.database
      .prepare(`${CHAPTER_SELECT} WHERE volume_id = ? AND order_key = ?`)
      .get(capturePublicationVolumeId(volumeId), captureOrderKey(orderKey)) as
      | ChapterRow
      | undefined;
    return row === undefined ? undefined : decodeChapter(row);
  }

  insertChapter(chapter: PublicationChapter): boolean {
    const value = capturePublicationChapter(chapter);
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO novel_publication_chapters(
           id, publication_id, volume_id, order_key, title
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.publicationId,
        value.volumeId,
        value.orderKey,
        value.title,
      );
    return Number(result.changes) === 1;
  }

  replaceChapter(chapter: PublicationChapter): boolean {
    const value = capturePublicationChapter(chapter);
    const result = this.database
      .prepare(
        `UPDATE novel_publication_chapters
         SET publication_id = ?, volume_id = ?, order_key = ?, title = ?
         WHERE id = ?`,
      )
      .run(
        value.publicationId,
        value.volumeId,
        value.orderKey,
        value.title,
        value.id,
      );
    return Number(result.changes) === 1;
  }

  deleteChapter(id: PublicationChapter["id"]): boolean {
    const result = this.database
      .prepare("DELETE FROM novel_publication_chapters WHERE id = ?")
      .run(capturePublicationChapterId(id));
    return Number(result.changes) === 1;
  }
}

function decodePublication(row: PublicationRow): PublicationStructure {
  return capturePublicationStructure({ id: row.id, novelId: row.novel_id });
}

function decodeVolume(row: VolumeRow): PublicationVolume {
  return capturePublicationVolume({
    id: row.id,
    publicationId: row.publication_id,
    orderKey: row.order_key,
    title: row.title,
    ...(row.primary_story_unit_id === null
      ? {}
      : { primaryStoryUnitId: row.primary_story_unit_id }),
  });
}

function decodeChapter(row: ChapterRow): PublicationChapter {
  return capturePublicationChapter({
    id: row.id,
    publicationId: row.publication_id,
    volumeId: row.volume_id,
    orderKey: row.order_key,
    title: row.title,
  });
}
