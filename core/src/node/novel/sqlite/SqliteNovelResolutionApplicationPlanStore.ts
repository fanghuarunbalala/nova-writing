/** Atomically persists and reconstructs one immutable plan per conflicted candidate. */
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NovelInvariantViolationError,
  NovelResolutionApplicationPlanIdentityConflictError,
  NOVEL_INVARIANT_FAILURE,
  canonicalizeNovelOperation,
  canonicalizeNovelResolutionApplicationEntry,
  canonicalizeNovelResolutionApplicationPlan,
  canonicalizeNovelResolutionApplicationPlanIdentity,
  NOVEL_RESOLUTION_APPLICATION_PLAN_VERSION,
  captureNovelConflictId,
  captureNovelDraftSession,
  captureNovelDraftSessionId,
  captureNovelOperation,
  captureNovelOperationDigest,
  captureNovelResolutionApplicationPlanDigest,
  captureNovelRevision,
  captureNovelResolutionApplicationPlan,
  captureNovelTimestamp,
  type NovelDraftSession,
  type NovelId,
  type NovelResolutionApplicationEntry,
  type NovelResolutionApplicationPlan,
  type NovelResolutionApplicationPlanStore,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import { digestNovelSha256Text } from "./NodeSha256NovelOperationDigester.js";
import { digestNovelResolutionApplicationPlanText } from "./NodeSha256NovelResolutionApplicationPlanDigester.js";
import { initializeNovelDraftSqliteSchema } from "./NovelDraftSqliteSchema.js";

export interface SqliteNovelResolutionApplicationPlanStoreOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly logger?: Logger;
}

interface PlanRow {
  plan_version: number;
  source_draft_session_id: string;
  conflicted_candidate_draft_session_id: string;
  base_revision: string;
  source_operation_count: number;
  effective_operation_count: number;
  plan_json: string;
  plan_digest: string;
  created_at: string;
}

interface EntryRow {
  source_sequence: number;
  action: string;
  conflict_id: string | null;
  strategy: string | null;
  operation_json: string | null;
  operation_digest: string | null;
  entry_json: string;
}

export class SqliteNovelResolutionApplicationPlanStore
  implements NovelResolutionApplicationPlanStore
{
  private readonly logger: Logger;

  constructor(
    private readonly options: SqliteNovelResolutionApplicationPlanStoreOptions,
  ) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_resolution_application_plan_store",
      workspaceId: options.location.workspaceId,
      novelId: options.novelId,
    });
  }

  async savePlan(
    sessionInput: NovelDraftSession,
    planInput: NovelResolutionApplicationPlan,
  ): Promise<"recorded" | "duplicate"> {
    const session = captureNovelDraftSession(sessionInput);
    const plan = captureNovelResolutionApplicationPlan(planInput);
    if (
      session.novelId !== this.options.novelId ||
      plan.conflictedCandidateDraftSessionId !== session.id ||
      digestNovelResolutionApplicationPlanText(
        canonicalizeNovelResolutionApplicationPlanIdentity(plan),
      ) !== plan.digest
    ) {
      throw corrupt(session);
    }
    verifyEntryDigests(session, plan.entries);
    initializeNovelDraftSqliteSchema(this.databasePath(session), session);
    const database = new DatabaseSync(this.databasePath(session));
    let transaction = false;
    try {
      configure(database);
      database.exec("BEGIN IMMEDIATE");
      transaction = true;
      const existing = readPlan(database, session);
      if (existing !== undefined) {
        if (
          existing.digest !== plan.digest ||
          canonicalizeNovelResolutionApplicationPlan(existing) !==
            canonicalizeNovelResolutionApplicationPlan(plan)
        ) {
          throw new NovelResolutionApplicationPlanIdentityConflictError(
            session.id,
          );
        }
        database.exec("COMMIT");
        transaction = false;
        return "duplicate";
      }

      database
        .prepare(
          `INSERT INTO resolution_application_plan(
             singleton, plan_version, source_draft_session_id,
             conflicted_candidate_draft_session_id, base_revision,
             source_operation_count, effective_operation_count, plan_json,
             plan_digest, created_at
           ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          plan.planVersion,
          plan.sourceDraftSessionId,
          plan.conflictedCandidateDraftSessionId,
          plan.baseRevision,
          plan.sourceOperationCount,
          plan.effectiveOperationCount,
          canonicalizeNovelResolutionApplicationPlan(plan),
          plan.digest,
          plan.createdAt,
        );
      const insertEntry = database.prepare(
        `INSERT INTO resolution_application_entries(
           source_sequence, action, conflict_id, strategy, operation_json,
           operation_digest, entry_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const entry of plan.entries) {
        insertEntry.run(
          entry.sourceSequence,
          entry.action,
          entry.action === "apply-original" ? null : entry.conflictId,
          entry.action === "apply-original" ? null : entry.strategy,
          entry.action === "skip"
            ? null
            : canonicalizeNovelOperation(entry.operation),
          entry.action === "skip" ? null : entry.operationDigest,
          canonicalizeNovelResolutionApplicationEntry(entry),
        );
      }
      database.exec("COMMIT");
      transaction = false;
      this.logger.info("novel_resolution_plan.recorded", {
        draftSessionId: session.id,
        sourceDraftSessionId: plan.sourceDraftSessionId,
        sourceOperationCount: plan.sourceOperationCount,
        effectiveOperationCount: plan.effectiveOperationCount,
      });
      return "recorded";
    } catch (error) {
      if (transaction) {
        try { database.exec("ROLLBACK"); } catch {}
      }
      if (
        error instanceof NovelInvariantViolationError ||
        error instanceof NovelResolutionApplicationPlanIdentityConflictError
      ) {
        throw error;
      }
      throw corrupt(session);
    } finally {
      database.close();
    }
  }

  async getPlan(
    sessionInput: NovelDraftSession,
  ): Promise<NovelResolutionApplicationPlan | undefined> {
    const session = captureNovelDraftSession(sessionInput);
    if (session.novelId !== this.options.novelId) throw corrupt(session);
    initializeNovelDraftSqliteSchema(this.databasePath(session), session);
    const database = new DatabaseSync(this.databasePath(session), {
      readOnly: true,
    });
    try {
      return readPlan(database, session);
    } catch (error) {
      if (error instanceof NovelInvariantViolationError) throw error;
      throw corrupt(session);
    } finally {
      database.close();
    }
  }

  private databasePath(session: NovelDraftSession): string {
    return join(
      this.options.location.stagingDir,
      session.ownerConversationId,
      session.id,
      "draft.sqlite",
    );
  }
}

function readPlan(
  database: DatabaseSync,
  session: NovelDraftSession,
): NovelResolutionApplicationPlan | undefined {
  const row = database
    .prepare(
      `SELECT plan_version, source_draft_session_id,
              conflicted_candidate_draft_session_id, base_revision,
              source_operation_count, effective_operation_count, plan_json,
              plan_digest, created_at
       FROM resolution_application_plan WHERE singleton = 1`,
    )
    .get() as PlanRow | undefined;
  if (row === undefined) return undefined;
  const entryRows = database
    .prepare(
      `SELECT source_sequence, action, conflict_id, strategy, operation_json,
              operation_digest, entry_json
       FROM resolution_application_entries ORDER BY source_sequence`,
    )
    .all() as unknown as EntryRow[];
  const entries = entryRows.map((entryRow) => readEntry(session, entryRow));
  if (row.plan_version !== NOVEL_RESOLUTION_APPLICATION_PLAN_VERSION) {
    throw corrupt(session);
  }
  const plan = captureNovelResolutionApplicationPlan({
    planVersion: NOVEL_RESOLUTION_APPLICATION_PLAN_VERSION,
    sourceDraftSessionId: captureNovelDraftSessionId(
      row.source_draft_session_id,
    ),
    conflictedCandidateDraftSessionId:
      captureNovelDraftSessionId(row.conflicted_candidate_draft_session_id),
    baseRevision: captureNovelRevision(row.base_revision),
    sourceOperationCount: row.source_operation_count,
    effectiveOperationCount: row.effective_operation_count,
    entries,
    digest: captureNovelResolutionApplicationPlanDigest(row.plan_digest),
    createdAt: captureNovelTimestamp(row.created_at),
  });
  if (
    plan.conflictedCandidateDraftSessionId !== session.id ||
    canonicalizeNovelResolutionApplicationPlan(plan) !== row.plan_json ||
    digestNovelResolutionApplicationPlanText(
      canonicalizeNovelResolutionApplicationPlanIdentity(plan),
    ) !== plan.digest
  ) {
    throw corrupt(session);
  }
  verifyEntryDigests(session, plan.entries);
  return plan;
}

function readEntry(
  session: NovelDraftSession,
  row: EntryRow,
): NovelResolutionApplicationEntry {
  let entry: NovelResolutionApplicationEntry;
  if (row.action === "apply-original") {
    if (
      row.conflict_id !== null ||
      row.strategy !== null ||
      row.operation_json === null ||
      row.operation_digest === null
    ) {
      throw corrupt(session);
    }
    entry = {
      sourceSequence: row.source_sequence,
      action: "apply-original",
      operation: captureNovelOperation(JSON.parse(row.operation_json)),
      operationDigest: captureNovelOperationDigest(row.operation_digest),
    };
  } else if (row.action === "apply-replacement") {
    if (
      row.conflict_id === null ||
      (row.strategy !== "keep-draft" && row.strategy !== "manual") ||
      row.operation_json === null ||
      row.operation_digest === null
    ) {
      throw corrupt(session);
    }
    entry = {
      sourceSequence: row.source_sequence,
      action: "apply-replacement",
      conflictId: captureNovelConflictId(row.conflict_id),
      strategy: row.strategy,
      operation: captureNovelOperation(JSON.parse(row.operation_json)),
      operationDigest: captureNovelOperationDigest(row.operation_digest),
    };
  } else if (row.action === "skip") {
    if (
      row.conflict_id === null ||
      (row.strategy !== "keep-canonical" &&
        row.strategy !== "keep-draft" &&
        row.strategy !== "drop-operation") ||
      row.operation_json !== null ||
      row.operation_digest !== null
    ) {
      throw corrupt(session);
    }
    entry = {
      sourceSequence: row.source_sequence,
      action: "skip",
      conflictId: captureNovelConflictId(row.conflict_id),
      strategy: row.strategy,
    };
  } else {
    throw corrupt(session);
  }
  if (canonicalizeNovelResolutionApplicationEntry(entry) !== row.entry_json) {
    throw corrupt(session);
  }
  return entry;
}

function verifyEntryDigests(
  session: NovelDraftSession,
  entries: readonly NovelResolutionApplicationEntry[],
): void {
  for (const entry of entries) {
    if (
      entry.action !== "skip" &&
      digestNovelSha256Text(canonicalizeNovelOperation(entry.operation)) !==
        entry.operationDigest
    ) {
      throw corrupt(session);
    }
  }
}

function corrupt(session: NovelDraftSession): NovelInvariantViolationError {
  return new NovelInvariantViolationError(
    NOVEL_INVARIANT_FAILURE.persistenceInvariant,
    session.novelId,
    session.id,
  );
}

function configure(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}
