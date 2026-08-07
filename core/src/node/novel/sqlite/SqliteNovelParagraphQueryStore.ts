/** SQLite explicit-scope Paragraph query adapter. */
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_INVARIANT_FAILURE,
  NovelInvariantViolationError,
  ParagraphCatalog,
  captureNovelId,
  captureNovelReadScope,
  captureParagraphId,
  captureStoryUnitId,
  type NovelId,
  type NovelParagraphQueryStore,
  type NovelReadScope,
  type ParagraphCatalogReadModel,
  type ParagraphId,
  type ParagraphReadModel,
  type StoryUnitId,
  type NovelEntityVersion,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import { SqliteNovelParagraphRepository } from "./SqliteNovelParagraphRepository.js";

export interface SqliteNovelParagraphQueryStoreOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly logger?: Logger;
}

export class SqliteNovelParagraphQueryStore implements NovelParagraphQueryStore {
  private readonly novelId: NovelId;
  private readonly logger: Logger;

  constructor(private readonly options: SqliteNovelParagraphQueryStoreOptions) {
    this.novelId = captureNovelId(options.novelId);
    this.logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_paragraph_query_store",
      workspaceId: options.location.workspaceId,
      novelId: this.novelId,
    });
  }

  getCatalog(scope: NovelReadScope): Promise<ParagraphCatalogReadModel | undefined> {
    return this.read(scope, (repository) => {
      const paragraphs = repository.listAllParagraphs();
      const snapshot = new ParagraphCatalog({ paragraphs }).getSnapshot();
      return Object.freeze({
        snapshot,
        paragraphDigests: Object.freeze(Object.fromEntries(paragraphs.map((paragraph) => [
          paragraph.id,
          Object.freeze(readDigests(repository, paragraph.id)),
        ]))),
      });
    });
  }

  getParagraph(
    scope: NovelReadScope,
    id: ParagraphId,
  ): Promise<ParagraphReadModel | undefined> {
    const paragraphId = captureParagraphId(id);
    return this.read(scope, (repository) => {
      const paragraph = repository.getParagraph(paragraphId);
      return paragraph === undefined
        ? undefined
        : Object.freeze({ paragraph, ...readDigests(repository, paragraphId) });
    });
  }

  getParagraphVersion(
    scope: NovelReadScope,
    id: ParagraphId,
  ): Promise<NovelEntityVersion | undefined> {
    const paragraphId = captureParagraphId(id);
    return this.read(scope, (repository) =>
      repository.getParagraphVersion(paragraphId),
    );
  }

  listParagraphsByStoryUnit(
    scope: NovelReadScope,
    storyUnitId: StoryUnitId,
  ): Promise<readonly ParagraphReadModel[]> {
    const captured = captureStoryUnitId(storyUnitId);
    return this.read(scope, (repository) =>
      Object.freeze(
        repository.listParagraphsByStoryUnit(captured).map((paragraph) =>
          Object.freeze({ paragraph, ...readDigests(repository, paragraph.id) })
        ),
      ),
    );
  }

  private async read<T>(
    scopeInput: NovelReadScope,
    query: (repository: SqliteNovelParagraphRepository) => T,
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
      const result = query(new SqliteNovelParagraphRepository(database));
      database.exec("COMMIT");
      transactionStarted = false;
      this.logger.debug("novel_paragraph_query.completed", { scope: scope.kind });
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

function readDigests(
  repository: SqliteNovelParagraphRepository,
  id: ParagraphId,
): { textDigest: string; orderDigest: string; storyUnitDigest: string } {
  const textDigest = repository.getParagraphDigest(id, "text");
  const orderDigest = repository.getParagraphDigest(id, "orderKey");
  const storyUnitDigest = repository.getParagraphDigest(id, "storyUnitId");
  if (
    textDigest === undefined ||
    orderDigest === undefined ||
    storyUnitDigest === undefined
  ) {
    throw new Error();
  }
  return { textDigest, orderDigest, storyUnitDigest };
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
    if (metadata === undefined || metadata.novel_id !== novelId) {
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.persistenceInvariant,
        novelId,
      );
    }
  }
}
