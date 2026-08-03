/** SQLite explicit-scope Story Outline query adapter for canonical and Draft state. */
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_INVARIANT_FAILURE,
  NovelInvariantViolationError,
  captureNovelId,
  captureNovelReadScope,
  captureStoryUnitId,
  type LeafStoryUnitPlanReadModel,
  type NovelId,
  type NovelOutlineQueryStore,
  type NovelReadScope,
  type StoryOutline,
  type StoryOutlineTreeSnapshot,
  type StoryUnit,
  type StoryUnitId,
  type StoryUnitReadModel,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import { SqliteNovelOutlineRepository } from "./SqliteNovelOutlineRepository.js";

export interface SqliteNovelOutlineQueryStoreOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly logger?: Logger;
}

export class SqliteNovelOutlineQueryStore implements NovelOutlineQueryStore {
  private readonly logger: Logger;
  private readonly novelId: NovelId;

  constructor(private readonly options: SqliteNovelOutlineQueryStoreOptions) {
    this.novelId = captureNovelId(options.novelId);
    this.logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_outline_query_store",
      workspaceId: options.location.workspaceId,
      novelId: this.novelId,
    });
  }

  getStoryOutline(scope: NovelReadScope): Promise<StoryOutline | undefined> {
    return this.read(scope, (repository) =>
      repository.findOutlineByNovelId(this.novelId),
    );
  }

  getStoryOutlineTreeSnapshot(
    scope: NovelReadScope,
  ): Promise<StoryOutlineTreeSnapshot | undefined> {
    return this.read(scope, (repository) => {
      const outline = repository.findOutlineByNovelId(this.novelId);
      return outline === undefined
        ? undefined
        : Object.freeze({
            outline,
            units: repository.listStoryUnits(outline.id),
          });
    });
  }

  listStoryUnits(scope: NovelReadScope): Promise<readonly StoryUnit[]> {
    return this.read(scope, (repository) => {
      const outline = repository.findOutlineByNovelId(this.novelId);
      return outline === undefined
        ? Object.freeze([])
        : repository.listStoryUnits(outline.id);
    });
  }

  getStoryUnit(
    scope: NovelReadScope,
    id: StoryUnitId,
  ): Promise<StoryUnitReadModel | undefined> {
    const storyUnitId = captureStoryUnitId(id);
    return this.read(scope, (repository) => {
      const unit = repository.getStoryUnit(storyUnitId);
      if (unit === undefined) return undefined;
      const contentDigest = repository.getStoryUnitDigest(storyUnitId, "content");
      const parentDigest = repository.getStoryUnitDigest(storyUnitId, "parentId");
      const orderDigest = repository.getStoryUnitDigest(storyUnitId, "orderKey");
      if (
        contentDigest === undefined ||
        parentDigest === undefined ||
        orderDigest === undefined
      ) {
        throw new Error();
      }
      return Object.freeze({
        unit,
        contentDigest,
        parentDigest,
        orderDigest,
      });
    });
  }

  getLeafStoryUnitPlan(
    scope: NovelReadScope,
    id: StoryUnitId,
  ): Promise<LeafStoryUnitPlanReadModel | undefined> {
    const storyUnitId = captureStoryUnitId(id);
    return this.read(scope, (repository) => {
      const plan = repository.getLeafStoryUnitPlan(storyUnitId);
      if (plan === undefined) return undefined;
      const planDigest = repository.getLeafStoryUnitPlanDigest(storyUnitId);
      if (planDigest === undefined) throw new Error();
      return Object.freeze({ plan, planDigest });
    });
  }

  private async read<T>(
    scope: NovelReadScope,
    query: (repository: SqliteNovelOutlineRepository) => T,
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
      database = new DatabaseSync(this.databasePath(capturedScope), {
        readOnly: true,
      });
      configure(database);
      assertReadIdentity(database, capturedScope, this.novelId);
      database.exec("BEGIN");
      transactionStarted = true;
      const result = query(new SqliteNovelOutlineRepository(database));
      database.exec("COMMIT");
      transactionStarted = false;
      this.logger.debug("novel_outline_query.completed", {
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
