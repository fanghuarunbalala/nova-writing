/** SQLite explicit-scope Evidence query and completion-admission adapter. */
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_INVARIANT_FAILURE,
  NovelInvariantViolationError,
  STORY_UNIT_PLANNING_STATUS,
  StoryOutlineTree,
  StoryUnitCompletionAdmissionValidator,
  StoryUnitConformanceEvaluator,
  captureNovelId,
  captureNovelReadScope,
  captureNovelRevision,
  captureStoryUnitId,
  type NovelEvidenceReadModel,
  type NovelId,
  type NovelMutationContext,
  type NovelProjectionEvidenceQueryStore,
  type NovelReadScope,
  type StoryUnitCharacterBinding,
  type StoryUnitCompletionAdmission,
  type StoryUnitEntityChange,
  type StoryUnitId,
  type StoryUnitLocationBinding,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import { createSqliteNovelMutationContext } from "./SqliteNovelOutlineRepository.js";

export interface SqliteNovelEvidenceQueryStoreOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly logger?: Logger;
}

export class SqliteNovelEvidenceQueryStore implements NovelProjectionEvidenceQueryStore {
  private readonly novelId: NovelId;
  private readonly logger: Logger;
  constructor(private readonly options: SqliteNovelEvidenceQueryStoreOptions) {
    this.novelId = captureNovelId(options.novelId);
    this.logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_evidence_query_store",
      workspaceId: options.location.workspaceId,
      novelId: this.novelId,
    });
  }

  listCharacterBindings(scope: NovelReadScope): Promise<readonly NovelEvidenceReadModel<StoryUnitCharacterBinding>[]> {
    return this.read(scope, (context) => Object.freeze(
      context.projectionEvidence.listCharacterBindings().map((value) => Object.freeze({
        value,
        recordDigest: requireDigest(context.projectionEvidence.getCharacterBindingDigest(value.storyUnitId, value.characterId)),
      })),
    ));
  }
  listLocationBindings(scope: NovelReadScope): Promise<readonly NovelEvidenceReadModel<StoryUnitLocationBinding>[]> {
    return this.read(scope, (context) => Object.freeze(
      context.projectionEvidence.listLocationBindings().map((value) => Object.freeze({
        value,
        recordDigest: requireDigest(context.projectionEvidence.getLocationBindingDigest(value.storyUnitId, value.locationId)),
      })),
    ));
  }
  listEntityChanges(scope: NovelReadScope): Promise<readonly NovelEvidenceReadModel<StoryUnitEntityChange>[]> {
    return this.read(scope, (context) => Object.freeze(
      context.projectionEvidence.listEntityChanges().map((value) => Object.freeze({
        value,
        recordDigest: requireDigest(context.projectionEvidence.getEntityChangeDigest(value.id)),
      })),
    ));
  }
  evaluateCompletion(
    scope: NovelReadScope,
    storyUnitIdInput: StoryUnitId,
  ): Promise<StoryUnitCompletionAdmission | undefined> {
    const storyUnitId = captureStoryUnitId(storyUnitIdInput);
    return this.read(scope, (context, revision) => {
      const outline = context.outline.findOutlineByNovelId(this.novelId);
      if (outline === undefined) throw new Error();
      const outlineTree = new StoryOutlineTree({
        outline,
        units: context.outline.listStoryUnits(outline.id),
      });
      const unit = outlineTree.getUnit(storyUnitId);
      if (unit === undefined) return undefined;
      const paragraphs = context.paragraph.listParagraphsByStoryUnit(storyUnitId);
      const hasAcceptedPlan =
        unit.planningStatus === STORY_UNIT_PLANNING_STATUS.ready;
      const conformance = new StoryUnitConformanceEvaluator().evaluate({
        paragraphs,
        hasAcceptedPlan,
        currentRevision: revision,
      });
      return new StoryUnitCompletionAdmissionValidator(outlineTree)
        .evaluate({
          storyUnitId,
          paragraphs,
          hasAcceptedPlan,
          conformance,
          currentRevision: revision,
        });
    });
  }

  private async read<T>(
    scopeInput: NovelReadScope,
    query: (context: NovelMutationContext, revision: ReturnType<typeof captureNovelRevision>) => T,
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
      const revision = readRevision(database, scope, this.novelId);
      database.exec("BEGIN");
      transactionStarted = true;
      const result = query(createSqliteNovelMutationContext(database), revision);
      database.exec("COMMIT");
      transactionStarted = false;
      this.logger.debug("novel_evidence_query.completed", { scope: scope.kind });
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
      : join(this.options.location.stagingDir, scope.session.ownerConversationId, scope.session.id, "draft.sqlite");
  }
}

function requireDigest(value: string | undefined): string {
  if (value === undefined) throw new Error();
  return value;
}
function configure(database: DatabaseSync): void {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}
function readRevision(database: DatabaseSync, scope: NovelReadScope, novelId: NovelId) {
  if (scope.kind === "canonical") {
    const row = database.prepare(
      "SELECT novel_id, current_revision FROM novel_metadata WHERE singleton = 1",
    ).get() as { novel_id: string; current_revision: string } | undefined;
    if (row?.novel_id !== novelId) throw new Error();
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
  if (
    row?.draft_session_id !== scope.session.id || row.novel_id !== scope.session.novelId ||
    row.owner_conversation_id !== scope.session.ownerConversationId || row.base_revision !== scope.session.baseRevision
  ) throw new Error();
  return captureNovelRevision(row.base_revision);
}
