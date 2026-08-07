/** SQLite-backed transaction-local Publication repository and explicit-scope query adapter. */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalStringifyJson } from "../../../event/index.js";
import {
  NOVEL_INVARIANT_FAILURE,
  NovelInvariantViolationError,
  PublicationCatalog,
  captureNovelId,
  captureNovelReadScope,
  captureOrderKey,
  captureParagraphId,
  capturePublicationChapter,
  capturePublicationChapterId,
  capturePublicationStructure,
  capturePublicationStructureId,
  capturePublicationVolume,
  capturePublicationVolumeId,
  type NovelMutablePublicationRepository,
  type NovelPublicationMutationContext,
  type NovelPublicationQueryStore,
  type NovelReadScope,
  type NovelId,
  type NovelEntityVersion,
  type ParagraphId,
  type PublicationCatalogReadModel,
  type PublicationChapterReadModel,
  type PublicationChapter,
  type PublicationChapterId,
  type PublicationStructure,
  type PublicationVolumeReadModel,
  type PublicationVolume,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";

interface PublicationRow {
  id: string;
  novel_id: string;
}

interface VolumeRow {
  id: string;
  publication_id: string;
  order_key: string;
  title: string;
}

interface ChapterRow {
  id: string;
  publication_id: string;
  volume_id: string;
  order_key: string;
  title: string;
}

const VOLUME_SELECT = `SELECT id, publication_id, order_key, title
  FROM novel_publication_volumes`;
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
  /** 本事务内已校验并推进过版本的实体（批内同实体多操作只校验一次）。 */
  private readonly confirmedVersions = new Set<string>();

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

  getVolumeDigest(id: PublicationVolume["id"]): string | undefined {
    const volume = this.getVolume(id);
    return volume === undefined ? undefined : digestPublicationRecord(volume);
  }

  getVolumeVersion(id: PublicationVolume["id"]): NovelEntityVersion | undefined {
    const row = this.database
      .prepare("SELECT entity_version FROM novel_publication_volumes WHERE id = ?")
      .get(capturePublicationVolumeId(id)) as
      | { entity_version: number }
      | undefined;
    return row === undefined
      ? undefined
      : (Number(row.entity_version) as NovelEntityVersion);
  }

  insertVolume(volume: PublicationVolume): boolean {
    const value = capturePublicationVolume(volume);
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO novel_publication_volumes(
           id, publication_id, order_key, title
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.publicationId,
        value.orderKey,
        value.title,
      );
    return Number(result.changes) === 1;
  }

  replaceVolume(
    volume: PublicationVolume,
    expectedEntityVersion?: NovelEntityVersion,
  ): boolean {
    const value = capturePublicationVolume(volume);
    const volumeId = value.id;
    if (
      expectedEntityVersion !== undefined &&
      !this.confirmedVersions.has(volumeId)
    ) {
      const row = this.database
        .prepare("SELECT entity_version FROM novel_publication_volumes WHERE id = ?")
        .get(capturePublicationVolumeId(volumeId)) as
        | { entity_version: number }
        | undefined;
      if (
        row === undefined ||
        Number(row.entity_version) !== (expectedEntityVersion as number)
      ) {
        return false;
      }
      this.confirmedVersions.add(volumeId);
    }
    const result = this.database
      .prepare(
        expectedEntityVersion === undefined
          ? `UPDATE novel_publication_volumes
             SET publication_id = ?, order_key = ?, title = ?
             WHERE id = ?`
          : `UPDATE novel_publication_volumes
             SET publication_id = ?, order_key = ?, title = ?,
                 entity_version = entity_version + 1
             WHERE id = ?`,
      )
      .run(
        value.publicationId,
        value.orderKey,
        value.title,
        value.id,
      );
    return Number(result.changes) === 1;
  }

  deleteVolume(
    id: PublicationVolume["id"],
    expectedEntityVersion?: NovelEntityVersion,
  ): boolean {
    const volumeId = capturePublicationVolumeId(id);
    if (
      expectedEntityVersion !== undefined &&
      !this.confirmedVersions.has(volumeId)
    ) {
      const row = this.database
        .prepare("SELECT entity_version FROM novel_publication_volumes WHERE id = ?")
        .get(volumeId) as { entity_version: number } | undefined;
      if (
        row === undefined ||
        Number(row.entity_version) !== (expectedEntityVersion as number)
      ) {
        return false;
      }
      this.confirmedVersions.add(volumeId);
    }
    const result = this.database
      .prepare("DELETE FROM novel_publication_volumes WHERE id = ?")
      .run(volumeId);
    return Number(result.changes) === 1;
  }

  getChapter(id: PublicationChapter["id"]): PublicationChapter | undefined {
    const row = this.database
      .prepare(`${CHAPTER_SELECT} WHERE id = ?`)
      .get(capturePublicationChapterId(id)) as ChapterRow | undefined;
    if (row === undefined) return undefined;
    return decodeChapter(row, this.listChapterParagraphIds(capturePublicationChapterId(id)));
  }

  listChapters(volumeId: PublicationChapter["volumeId"]): readonly PublicationChapter[] {
    const rows = this.database
      .prepare(`${CHAPTER_SELECT} WHERE volume_id = ? ORDER BY order_key, id`)
      .all(capturePublicationVolumeId(volumeId)) as unknown as ChapterRow[];
    return Object.freeze(rows.map((row) =>
      decodeChapter(row, this.listChapterParagraphIds(capturePublicationChapterId(row.id)))
    ));
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
    if (row === undefined) return undefined;
    return decodeChapter(row, this.listChapterParagraphIds(capturePublicationChapterId(row.id)));
  }

  getChapterDigest(id: PublicationChapter["id"]): string | undefined {
    const chapter = this.getChapter(id);
    return chapter === undefined ? undefined : digestPublicationRecord(chapter);
  }

  getChapterVersion(id: PublicationChapter["id"]): NovelEntityVersion | undefined {
    const row = this.database
      .prepare("SELECT entity_version FROM novel_publication_chapters WHERE id = ?")
      .get(capturePublicationChapterId(id)) as
      | { entity_version: number }
      | undefined;
    return row === undefined
      ? undefined
      : (Number(row.entity_version) as NovelEntityVersion);
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

  replaceChapter(
    chapter: PublicationChapter,
    expectedEntityVersion?: NovelEntityVersion,
  ): boolean {
    const value = capturePublicationChapter(chapter);
    const chapterId = value.id;
    if (
      expectedEntityVersion !== undefined &&
      !this.confirmedVersions.has(chapterId)
    ) {
      const row = this.database
        .prepare("SELECT entity_version FROM novel_publication_chapters WHERE id = ?")
        .get(capturePublicationChapterId(chapterId)) as
        | { entity_version: number }
        | undefined;
      if (
        row === undefined ||
        Number(row.entity_version) !== (expectedEntityVersion as number)
      ) {
        return false;
      }
      this.confirmedVersions.add(chapterId);
    }
    const result = this.database
      .prepare(
        expectedEntityVersion === undefined
          ? `UPDATE novel_publication_chapters
             SET publication_id = ?, volume_id = ?, order_key = ?, title = ?
             WHERE id = ?`
          : `UPDATE novel_publication_chapters
             SET publication_id = ?, volume_id = ?, order_key = ?, title = ?,
                 entity_version = entity_version + 1
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

  deleteChapter(
    id: PublicationChapter["id"],
    expectedEntityVersion?: NovelEntityVersion,
  ): boolean {
    const chapterId = capturePublicationChapterId(id);
    if (
      expectedEntityVersion !== undefined &&
      !this.confirmedVersions.has(chapterId)
    ) {
      const row = this.database
        .prepare("SELECT entity_version FROM novel_publication_chapters WHERE id = ?")
        .get(chapterId) as { entity_version: number } | undefined;
      if (
        row === undefined ||
        Number(row.entity_version) !== (expectedEntityVersion as number)
      ) {
        return false;
      }
      this.confirmedVersions.add(chapterId);
    }
    const result = this.database
      .prepare("DELETE FROM novel_publication_chapters WHERE id = ?")
      .run(chapterId);
    this.database
      .prepare("DELETE FROM novel_chapter_paragraphs WHERE chapter_id = ?")
      .run(chapterId);
    return Number(result.changes) === 1;
  }

  listChapterParagraphIds(chapterId: PublicationChapterId): readonly ParagraphId[] {
    const rows = this.database
      .prepare(
        `SELECT paragraph_id FROM novel_chapter_paragraphs
         WHERE chapter_id = ? ORDER BY position, paragraph_id`,
      )
      .all(capturePublicationChapterId(chapterId)) as Array<{ paragraph_id: string }>;
    return Object.freeze(rows.map((row) => captureParagraphId(row.paragraph_id)));
  }

  setChapterParagraphIds(
    chapterId: PublicationChapterId,
    paragraphIds: readonly ParagraphId[],
  ): boolean {
    const id = capturePublicationChapterId(chapterId);
    this.database
      .prepare("DELETE FROM novel_chapter_paragraphs WHERE chapter_id = ?")
      .run(id);
    if (paragraphIds.length === 0) return true;
    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO novel_chapter_paragraphs(
         chapter_id, paragraph_id, position
       ) VALUES (?, ?, ?)`,
    );
    for (let position = 0; position < paragraphIds.length; position += 1) {
      insert.run(id, captureParagraphId(paragraphIds[position]), position);
    }
    const count = this.database
      .prepare(
        "SELECT COUNT(*) AS count FROM novel_chapter_paragraphs WHERE chapter_id = ?",
      )
      .get(id) as { count: number };
    return Number(count.count) === paragraphIds.length;
  }

  getChapterIdByParagraphId(paragraphId: ParagraphId): PublicationChapterId | undefined {
    const row = this.database
      .prepare(
        "SELECT chapter_id FROM novel_chapter_paragraphs WHERE paragraph_id = ? LIMIT 1",
      )
      .get(captureParagraphId(paragraphId)) as { chapter_id: string } | undefined;
    return row === undefined
      ? undefined
      : capturePublicationChapterId(row.chapter_id);
  }

  hasParagraph(paragraphId: ParagraphId): boolean {
    const row = this.database
      .prepare("SELECT 1 AS present FROM novel_paragraphs WHERE id = ? LIMIT 1")
      .get(captureParagraphId(paragraphId)) as { present: number } | undefined;
    return row !== undefined;
  }
}

export interface SqliteNovelPublicationQueryStoreOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly logger?: Logger;
}

export class SqliteNovelPublicationQueryStore implements NovelPublicationQueryStore {
  private readonly novelId: NovelId;
  private readonly logger: Logger;

  constructor(private readonly options: SqliteNovelPublicationQueryStoreOptions) {
    this.novelId = captureNovelId(options.novelId);
    this.logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_publication_query_store",
      workspaceId: options.location.workspaceId,
      novelId: this.novelId,
    });
  }

  getCatalog(scope: NovelReadScope): Promise<PublicationCatalogReadModel | undefined> {
    return this.read(scope, (repository) => {
      const publication = repository.findPublicationByNovelId(this.novelId);
      if (publication === undefined) return undefined;
      const volumes = repository.listVolumes(publication.id);
      const chapters = volumes.flatMap((volume) => repository.listChapters(volume.id));
      const snapshot = new PublicationCatalog({ publication, volumes, chapters }).getSnapshot();
      return Object.freeze({
        snapshot,
        volumeDigests: Object.freeze(Object.fromEntries(volumes.map((volume) => [
          volume.id,
          requireDigest(repository.getVolumeDigest(volume.id)),
        ]))),
        chapterDigests: Object.freeze(Object.fromEntries(chapters.map((chapter) => [
          chapter.id,
          requireDigest(repository.getChapterDigest(chapter.id)),
        ]))),
      });
    });
  }

  getVolume(
    scope: NovelReadScope,
    id: PublicationVolume["id"],
  ): Promise<PublicationVolumeReadModel | undefined> {
    const volumeId = capturePublicationVolumeId(id);
    return this.read(scope, (repository) => {
      const volume = repository.getVolume(volumeId);
      return volume === undefined
        ? undefined
        : Object.freeze({
            volume,
            recordDigest: requireDigest(repository.getVolumeDigest(volumeId)),
          });
    });
  }

  getVolumeVersion(
    scope: NovelReadScope,
    id: PublicationVolume["id"],
  ): Promise<NovelEntityVersion | undefined> {
    const volumeId = capturePublicationVolumeId(id);
    return this.read(scope, (repository) =>
      repository.getVolumeVersion(volumeId),
    );
  }

  listVolumes(scope: NovelReadScope): Promise<readonly PublicationVolumeReadModel[]> {
    return this.read(scope, (repository) => {
      const publication = repository.findPublicationByNovelId(this.novelId);
      if (publication === undefined) return Object.freeze([]);
      return Object.freeze(repository.listVolumes(publication.id).map((volume) =>
        Object.freeze({
          volume,
          recordDigest: requireDigest(repository.getVolumeDigest(volume.id)),
        })
      ));
    });
  }

  getChapter(
    scope: NovelReadScope,
    id: PublicationChapter["id"],
  ): Promise<PublicationChapterReadModel | undefined> {
    const chapterId = capturePublicationChapterId(id);
    return this.read(scope, (repository) => {
      const chapter = repository.getChapter(chapterId);
      return chapter === undefined
        ? undefined
        : Object.freeze({
            chapter,
            recordDigest: requireDigest(repository.getChapterDigest(chapterId)),
          });
    });
  }

  getChapterVersion(
    scope: NovelReadScope,
    id: PublicationChapter["id"],
  ): Promise<NovelEntityVersion | undefined> {
    const chapterId = capturePublicationChapterId(id);
    return this.read(scope, (repository) =>
      repository.getChapterVersion(chapterId),
    );
  }

  listChapters(
    scope: NovelReadScope,
    volumeIdInput: PublicationVolume["id"],
  ): Promise<readonly PublicationChapterReadModel[]> {
    const volumeId = capturePublicationVolumeId(volumeIdInput);
    return this.read(scope, (repository) => Object.freeze(
      repository.listChapters(volumeId).map((chapter) => Object.freeze({
        chapter,
        recordDigest: requireDigest(repository.getChapterDigest(chapter.id)),
      })),
    ));
  }

  private async read<T>(
    scope: NovelReadScope,
    query: (repository: SqliteNovelPublicationRepository) => T,
  ): Promise<T> {
    const capturedScope = captureNovelReadScope(scope);
    if (
      capturedScope.kind === "draft" &&
      capturedScope.session.novelId !== this.novelId
    ) {
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.novelIdentityMismatch,
        this.novelId,
        capturedScope.session.id,
      );
    }
    let database: DatabaseSync | undefined;
    let transactionStarted = false;
    try {
      database = new DatabaseSync(this.databasePath(capturedScope), { readOnly: true });
      configure(database);
      assertReadIdentity(database, capturedScope, this.novelId);
      database.exec("BEGIN");
      transactionStarted = true;
      const result = query(new SqliteNovelPublicationRepository(database));
      database.exec("COMMIT");
      transactionStarted = false;
      this.logger.debug("novel_publication_query.completed", {
        scope: capturedScope.kind,
      });
      return result;
    } catch (error) {
      if (transactionStarted) {
        try {
          database?.exec("ROLLBACK");
        } catch {}
      }
      if (error instanceof NovelInvariantViolationError) throw error;
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.persistenceInvariant,
        this.novelId,
        capturedScope.kind === "draft" ? capturedScope.session.id : undefined,
      );
    } finally {
      try {
        database?.close();
      } catch {}
    }
  }

  private databasePath(scope: NovelReadScope): string {
    return scope.kind === "canonical"
      ? this.options.location.canonicalDatabasePath
      : join(
          this.options.location.stagingDir,
          scope.session.ownerConversationId,
          scope.session.id,
          "draft.sqlite",
        );
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
  });
}

function decodeChapter(
  row: ChapterRow,
  paragraphIds: readonly ParagraphId[],
): PublicationChapter {
  return capturePublicationChapter({
    id: row.id,
    publicationId: row.publication_id,
    volumeId: row.volume_id,
    orderKey: row.order_key,
    title: row.title,
    paragraphIds,
  });
}

function digestPublicationRecord(value: PublicationVolume | PublicationChapter): string {
  return createHash("sha256")
    .update(canonicalStringifyJson(value as never))
    .digest("hex");
}

function requireDigest(value: string | undefined): string {
  if (value === undefined) throw new Error();
  return value;
}

function configure(database: DatabaseSync): void {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}

function assertReadIdentity(
  database: DatabaseSync,
  scope: NovelReadScope,
  novelId: NovelId,
): void {
  if (scope.kind === "canonical") {
    const metadata = database
      .prepare("SELECT novel_id FROM novel_metadata WHERE singleton = 1")
      .get() as { novel_id: string } | undefined;
    if (metadata?.novel_id !== novelId) throw new Error();
    return;
  }
  const metadata = database
    .prepare(
      `SELECT draft_session_id, novel_id, owner_conversation_id, base_revision
       FROM draft_metadata WHERE singleton = 1`,
    )
    .get() as
    | {
        draft_session_id: string;
        novel_id: string;
        owner_conversation_id: string;
        base_revision: string;
      }
    | undefined;
  if (
    metadata?.draft_session_id !== scope.session.id ||
    metadata.novel_id !== scope.session.novelId ||
    metadata.owner_conversation_id !== scope.session.ownerConversationId ||
    metadata.base_revision !== scope.session.baseRevision
  ) {
    throw new Error();
  }
}
