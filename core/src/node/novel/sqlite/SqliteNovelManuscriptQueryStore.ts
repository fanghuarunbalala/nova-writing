/** SQLite explicit-scope Manuscript and repair query adapter. */
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_INVARIANT_FAILURE,
  ManuscriptCatalog,
  ManuscriptRepairCatalog,
  NovelInvariantViolationError,
  PublicationCatalog,
  captureManuscriptBlockId,
  captureNovelId,
  captureNovelReadScope,
  type ManuscriptBlockId,
  type ManuscriptBlockReadModel,
  type ManuscriptCatalogReadModel,
  type ManuscriptRepairCatalogSnapshot,
  type NovelId,
  type NovelManuscriptQueryStore,
  type NovelReadScope,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import { SqliteNovelManuscriptRepository } from "./SqliteNovelManuscriptRepository.js";
import { SqliteNovelPublicationRepository } from "./SqliteNovelPublicationRepository.js";

export interface SqliteNovelManuscriptQueryStoreOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly logger?: Logger;
}

export class SqliteNovelManuscriptQueryStore implements NovelManuscriptQueryStore {
  private readonly novelId: NovelId;
  private readonly logger: Logger;

  constructor(private readonly options: SqliteNovelManuscriptQueryStoreOptions) {
    this.novelId = captureNovelId(options.novelId);
    this.logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_manuscript_query_store",
      workspaceId: options.location.workspaceId,
      novelId: this.novelId,
    });
  }

  getCatalog(scope: NovelReadScope): Promise<ManuscriptCatalogReadModel | undefined> {
    return this.read(scope, (manuscriptRepository, publicationRepository) => {
      const manuscript = manuscriptRepository.findManuscriptByNovelId(this.novelId);
      const publication = publicationRepository.findPublicationByNovelId(this.novelId);
      if (manuscript === undefined || publication === undefined) return undefined;
      const volumes = publicationRepository.listVolumes(publication.id);
      const chapters = volumes.flatMap((volume) => publicationRepository.listChapters(volume.id));
      const publicationCatalog = new PublicationCatalog({ publication, volumes, chapters });
      const blocks = manuscriptRepository.listBlocks(manuscript.id);
      const snapshot = new ManuscriptCatalog({ manuscript, blocks }, publicationCatalog).getSnapshot();
      return Object.freeze({
        snapshot,
        blockDigests: Object.freeze(Object.fromEntries(blocks.map((block) => [
          block.id,
          Object.freeze(readDigests(manuscriptRepository, block.id)),
        ]))),
      });
    });
  }

  getBlock(
    scope: NovelReadScope,
    id: ManuscriptBlockId,
  ): Promise<ManuscriptBlockReadModel | undefined> {
    const blockId = captureManuscriptBlockId(id);
    return this.read(scope, (repository) => {
      const block = repository.getBlock(blockId);
      return block === undefined
        ? undefined
        : Object.freeze({ block, ...readDigests(repository, blockId) });
    });
  }

  listBlocks(scope: NovelReadScope): Promise<readonly ManuscriptBlockReadModel[]> {
    return this.read(scope, (repository) => {
      const manuscript = repository.findManuscriptByNovelId(this.novelId);
      if (manuscript === undefined) return Object.freeze([]);
      return Object.freeze(repository.listBlocks(manuscript.id).map((block) =>
        Object.freeze({ block, ...readDigests(repository, block.id) })
      ));
    });
  }

  getRepairs(scope: NovelReadScope): Promise<ManuscriptRepairCatalogSnapshot | undefined> {
    return this.read(scope, (manuscriptRepository, publicationRepository) => {
      const manuscript = manuscriptRepository.findManuscriptByNovelId(this.novelId);
      const publication = publicationRepository.findPublicationByNovelId(this.novelId);
      if (manuscript === undefined || publication === undefined) return undefined;
      const volumes = publicationRepository.listVolumes(publication.id);
      const chapters = volumes.flatMap((volume) => publicationRepository.listChapters(volume.id));
      const manuscriptCatalog = new ManuscriptCatalog(
        { manuscript, blocks: manuscriptRepository.listBlocks(manuscript.id) },
        new PublicationCatalog({ publication, volumes, chapters }),
      );
      return new ManuscriptRepairCatalog({
        tombstones: manuscriptRepository.listTombstones(manuscript.id),
        redirects: manuscriptRepository.listAnchorRedirects(),
      }, manuscriptCatalog).getSnapshot();
    });
  }

  private async read<T>(
    scopeInput: NovelReadScope,
    query: (
      manuscript: SqliteNovelManuscriptRepository,
      publication: SqliteNovelPublicationRepository,
    ) => T,
  ): Promise<T> {
    const scope = captureNovelReadScope(scopeInput);
    if (scope.kind === "draft" && scope.session.novelId !== this.novelId) {
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.novelIdentityMismatch,
        this.novelId,
        scope.session.id,
      );
    }
    let database: DatabaseSync | undefined;
    let transactionStarted = false;
    try {
      database = new DatabaseSync(this.databasePath(scope), { readOnly: true });
      configure(database);
      assertReadIdentity(database, scope, this.novelId);
      database.exec("BEGIN");
      transactionStarted = true;
      const result = query(
        new SqliteNovelManuscriptRepository(database),
        new SqliteNovelPublicationRepository(database),
      );
      database.exec("COMMIT");
      transactionStarted = false;
      this.logger.debug("novel_manuscript_query.completed", { scope: scope.kind });
      return result;
    } catch (error) {
      if (transactionStarted) {
        try { database?.exec("ROLLBACK"); } catch {}
      }
      if (error instanceof NovelInvariantViolationError) throw error;
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.persistenceInvariant,
        this.novelId,
        scope.kind === "draft" ? scope.session.id : undefined,
      );
    } finally {
      try { database?.close(); } catch {}
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

function readDigests(repository: SqliteNovelManuscriptRepository, id: ManuscriptBlockId) {
  const textDigest = repository.getBlockDigest(id, "text");
  const chapterDigest = repository.getBlockDigest(id, "chapterId");
  const orderDigest = repository.getBlockDigest(id, "orderKey");
  if (textDigest === undefined || chapterDigest === undefined || orderDigest === undefined) {
    throw new Error();
  }
  return { textDigest, chapterDigest, orderDigest };
}

function configure(database: DatabaseSync): void {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}

function assertReadIdentity(database: DatabaseSync, scope: NovelReadScope, novelId: NovelId): void {
  if (scope.kind === "canonical") {
    const metadata = database.prepare(
      "SELECT novel_id FROM novel_metadata WHERE singleton = 1",
    ).get() as { novel_id: string } | undefined;
    if (metadata?.novel_id !== novelId) throw new Error();
    return;
  }
  const metadata = database.prepare(
    `SELECT draft_session_id, novel_id, owner_conversation_id, base_revision
     FROM draft_metadata WHERE singleton = 1`,
  ).get() as {
    draft_session_id: string;
    novel_id: string;
    owner_conversation_id: string;
    base_revision: string;
  } | undefined;
  if (
    metadata?.draft_session_id !== scope.session.id ||
    metadata.novel_id !== scope.session.novelId ||
    metadata.owner_conversation_id !== scope.session.ownerConversationId ||
    metadata.base_revision !== scope.session.baseRevision
  ) throw new Error();
}
