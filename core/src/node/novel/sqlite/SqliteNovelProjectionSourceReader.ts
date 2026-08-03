/** Rebuilds one explicit-scope Projection planning context in a single SQLite read transaction. */
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ManuscriptCatalog,
  ManuscriptRangeRepairValidator,
  ManuscriptRepairCatalog,
  NOVEL_INVARIANT_FAILURE,
  NovelInvariantViolationError,
  PublicationCatalog,
  StoryOutlineTree,
  captureNovelId,
  captureNovelReadScope,
  captureNovelRevision,
  type NovelId,
  type NovelProjectionPlanningContext,
  type NovelProjectionSourceReader,
  type NovelReadScope,
  type NovelRevision,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import { createSqliteNovelMutationContext } from "./SqliteNovelOutlineRepository.js";

export interface SqliteNovelProjectionSourceReaderOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly scope: NovelReadScope;
  readonly logger?: Logger;
}

export class SqliteNovelProjectionSourceReader
  implements NovelProjectionSourceReader
{
  private readonly novelId: NovelId;
  private readonly scope: NovelReadScope;
  private readonly logger: Logger;

  constructor(private readonly options: SqliteNovelProjectionSourceReaderOptions) {
    this.novelId = captureNovelId(options.novelId);
    this.scope = captureNovelReadScope(options.scope);
    if (
      this.scope.kind === "draft" &&
      this.scope.session.novelId !== this.novelId
    ) {
      throw this.invariant();
    }
    this.logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_projection_source_reader",
      workspaceId: options.location.workspaceId,
      novelId: this.novelId,
      scope: this.scope.kind,
    });
  }

  async readProjectionContext(
    novelIdInput: NovelId,
  ): Promise<NovelProjectionPlanningContext> {
    if (captureNovelId(novelIdInput) !== this.novelId) throw this.invariant();
    let database: DatabaseSync | undefined;
    let transactionStarted = false;
    try {
      database = new DatabaseSync(this.databasePath(), { readOnly: true });
      database.exec("PRAGMA foreign_keys = ON");
      database.exec("PRAGMA busy_timeout = 5000");
      database.exec("BEGIN");
      transactionStarted = true;
      const currentRevision = this.readRevision(database);
      const context = createSqliteNovelMutationContext(database);
      const outline = context.outline.findOutlineByNovelId(this.novelId);
      const publication = context.publication.findPublicationByNovelId(this.novelId);
      const manuscript = context.manuscript.findManuscriptByNovelId(this.novelId);
      if (outline === undefined || publication === undefined || manuscript === undefined) {
        throw this.invariant();
      }
      const outlineTree = new StoryOutlineTree({
        outline,
        units: context.outline.listStoryUnits(outline.id),
      });
      const volumes = context.publication.listVolumes(publication.id);
      const publicationCatalog = new PublicationCatalog({
        publication,
        volumes,
        chapters: volumes.flatMap((volume) =>
          context.publication.listChapters(volume.id)
        ),
      });
      const manuscriptCatalog = new ManuscriptCatalog({
        manuscript,
        blocks: context.manuscript.listBlocks(manuscript.id),
      }, publicationCatalog);
      const repairCatalog = new ManuscriptRepairCatalog({
        tombstones: context.manuscript.listTombstones(manuscript.id),
        redirects: context.manuscript.listAnchorRedirects(),
      }, manuscriptCatalog);
      const result = Object.freeze({
        outline: outlineTree,
        source: Object.freeze({
          currentRevision,
          characters: context.characters.list(),
          locations: context.locations.list(),
          entityChanges: context.projectionEvidence.listEntityChanges(),
          realizations: context.projectionEvidence.listRealizations(),
          characterBindings:
            context.projectionEvidence.listCharacterBindings(),
          locationBindings: context.projectionEvidence.listLocationBindings(),
        }),
        ranges: new ManuscriptRangeRepairValidator(
          manuscriptCatalog,
          repairCatalog,
        ),
      });
      database.exec("COMMIT");
      transactionStarted = false;
      this.logger.debug("novel_projection_source.read_completed", {
        novelId: this.novelId,
        scope: this.scope.kind,
        storyUnitCount: outlineTree.listDepthFirst().length,
        characterCount: result.source.characters.length,
        locationCount: result.source.locations.length,
        realizationCount: result.source.realizations.length,
      });
      return result;
    } catch (error) {
      if (transactionStarted) {
        try {
          database?.exec("ROLLBACK");
        } catch {}
      }
      if (error instanceof NovelInvariantViolationError) throw error;
      throw this.invariant();
    } finally {
      try {
        database?.close();
      } catch {}
    }
  }

  private readRevision(database: DatabaseSync): NovelRevision {
    if (this.scope.kind === "canonical") {
      const row = database.prepare(
        "SELECT novel_id, current_revision FROM novel_metadata WHERE singleton = 1",
      ).get() as { novel_id: string; current_revision: string } | undefined;
      if (row?.novel_id !== this.novelId) throw this.invariant();
      return captureNovelRevision(row.current_revision);
    }
    const row = database.prepare(
      `SELECT draft_session_id, novel_id, owner_conversation_id, base_revision
       FROM draft_metadata WHERE singleton = 1`,
    ).get() as {
      draft_session_id: string;
      novel_id: string;
      owner_conversation_id: string;
      base_revision: string;
    } | undefined;
    const session = this.scope.session;
    if (
      row?.draft_session_id !== session.id ||
      row.novel_id !== this.novelId ||
      row.owner_conversation_id !== session.ownerConversationId ||
      row.base_revision !== session.baseRevision
    ) {
      throw this.invariant();
    }
    return captureNovelRevision(row.base_revision);
  }

  private databasePath(): string {
    return this.scope.kind === "canonical"
      ? this.options.location.canonicalDatabasePath
      : join(
          this.options.location.stagingDir,
          this.scope.session.ownerConversationId,
          this.scope.session.id,
          "draft.sqlite",
        );
  }

  private invariant(): NovelInvariantViolationError {
    return new NovelInvariantViolationError(
      NOVEL_INVARIANT_FAILURE.persistenceInvariant,
      this.novelId,
      this.scope.kind === "draft" ? this.scope.session.id : undefined,
    );
  }
}
