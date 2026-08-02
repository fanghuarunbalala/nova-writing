/** Persists resolved sibling candidate identities in canonical SQLite. */
import { DatabaseSync } from "node:sqlite";
import {
  NovelRebaseCandidateIdentityConflictError,
  captureNovelConversationId,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelResolvedRebaseCandidate,
  captureNovelRevision,
  captureNovelTimestamp,
  captureNovelWorkspaceId,
  type NovelDraftSessionId,
  type NovelId,
  type NovelResolvedRebaseCandidate,
  type NovelResolvedRebaseCandidateStore,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import { NOVEL_DATABASE_FAILURE, NovelDatabaseError } from "./NovelDatabaseErrors.js";

interface Row {
  resolved_candidate_draft_session_id: string;
  novel_id: string;
  source_draft_session_id: string;
  conflicted_candidate_draft_session_id: string;
  owner_conversation_id: string;
  candidate_base_revision: string;
  resolution_plan_digest: string;
  operation_count: number;
  last_operation_sequence: number;
  prepared_at: string;
}

export interface SqliteNovelResolvedRebaseCandidateStoreOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly logger?: Logger;
}

export class SqliteNovelResolvedRebaseCandidateStore
  implements NovelResolvedRebaseCandidateStore {
  private closed = false;
  private constructor(
    private readonly database: DatabaseSync,
    private readonly novelId: NovelId,
    private readonly workspaceId: string,
    private readonly logger: Logger,
  ) {}

  static async open(
    options: SqliteNovelResolvedRebaseCandidateStoreOptions,
  ): Promise<SqliteNovelResolvedRebaseCandidateStore> {
    const workspaceId = captureNovelWorkspaceId(options.location.workspaceId);
    const novelId = captureNovelId(options.novelId);
    const database = new DatabaseSync(options.location.canonicalDatabasePath);
    try {
      configure(database);
      const row = database.prepare(
        "SELECT novel_id, workspace_id FROM novel_metadata WHERE singleton = 1",
      ).get() as { novel_id: string; workspace_id: string } | undefined;
      database.prepare("SELECT resolved_candidate_draft_session_id FROM novel_resolved_rebase_candidates LIMIT 0");
      if (row?.novel_id !== novelId || row.workspace_id !== workspaceId) throw new Error();
      return new SqliteNovelResolvedRebaseCandidateStore(
        database,
        novelId,
        workspaceId,
        (options.logger ?? noopLogger).child({
          component: "sqlite_novel_resolved_rebase_candidate_store",
          workspaceId,
          novelId,
        }),
      );
    } catch {
      try { database.close(); } catch {}
      throw new NovelDatabaseError(NOVEL_DATABASE_FAILURE.invalidStructure, workspaceId, novelId);
    }
  }

  async createResolvedCandidate(input: NovelResolvedRebaseCandidate): Promise<void> {
    this.assertOpen();
    const candidate = captureNovelResolvedRebaseCandidate(input);
    if (candidate.session.novelId !== this.novelId) throw invalid(this.workspaceId, this.novelId);
    try {
      this.database.prepare(
        `INSERT INTO novel_resolved_rebase_candidates(
           resolved_candidate_draft_session_id, novel_id, source_draft_session_id,
           conflicted_candidate_draft_session_id, owner_conversation_id,
           candidate_base_revision, resolution_plan_digest, operation_count,
           last_operation_sequence, prepared_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        candidate.session.id, candidate.session.novelId,
        candidate.sourceDraftSessionId, candidate.conflictedCandidateDraftSessionId,
        candidate.session.ownerConversationId, candidate.session.baseRevision,
        candidate.resolutionPlanDigest, candidate.operationCount,
        candidate.lastOperationSequence, candidate.preparedAt,
      );
      this.logger.info("novel_resolved_candidate_store.created", {
        sourceDraftSessionId: candidate.sourceDraftSessionId,
        conflictedCandidateDraftSessionId: candidate.conflictedCandidateDraftSessionId,
        resolvedCandidateDraftSessionId: candidate.session.id,
        operationCount: candidate.operationCount,
      });
    } catch {
      const existing = this.database.prepare(
        `${SELECT} WHERE novel_id = ? AND conflicted_candidate_draft_session_id = ?`,
      ).get(this.novelId, candidate.conflictedCandidateDraftSessionId) as Row | undefined;
      if (existing !== undefined) {
        throw new NovelRebaseCandidateIdentityConflictError(
          candidate.conflictedCandidateDraftSessionId,
          captureNovelDraftSessionId(existing.resolved_candidate_draft_session_id),
        );
      }
      throw invalid(this.workspaceId, this.novelId);
    }
  }

  async getResolvedCandidate(
    novelId: NovelId,
    resolvedCandidateDraftSessionId: NovelDraftSessionId,
  ): Promise<NovelResolvedRebaseCandidate | undefined> {
    this.assertIdentity(novelId);
    const row = this.database.prepare(
      `${SELECT} WHERE novel_id = ? AND resolved_candidate_draft_session_id = ?`,
    ).get(this.novelId, captureNovelDraftSessionId(resolvedCandidateDraftSessionId)) as Row | undefined;
    return row === undefined ? undefined : captureRow(row);
  }

  async listResolvedCandidates(novelId: NovelId): Promise<readonly NovelResolvedRebaseCandidate[]> {
    this.assertIdentity(novelId);
    return Object.freeze((this.database.prepare(
      `${SELECT} WHERE novel_id = ? ORDER BY prepared_at, resolved_candidate_draft_session_id`,
    ).all(this.novelId) as unknown as Row[]).map(captureRow));
  }

  async removeResolvedCandidate(novelId: NovelId, id: NovelDraftSessionId): Promise<void> {
    this.assertIdentity(novelId);
    this.database.prepare(
      "DELETE FROM novel_resolved_rebase_candidates WHERE novel_id = ? AND resolved_candidate_draft_session_id = ?",
    ).run(this.novelId, captureNovelDraftSessionId(id));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  private assertIdentity(value: NovelId): void {
    this.assertOpen();
    if (captureNovelId(value) !== this.novelId) throw invalid(this.workspaceId, this.novelId);
  }
  private assertOpen(): void {
    if (this.closed) throw invalid(this.workspaceId, this.novelId);
  }
}

const SELECT = `SELECT resolved_candidate_draft_session_id, novel_id,
  source_draft_session_id, conflicted_candidate_draft_session_id,
  owner_conversation_id, candidate_base_revision, resolution_plan_digest,
  operation_count, last_operation_sequence, prepared_at
  FROM novel_resolved_rebase_candidates`;

function captureRow(row: Row): NovelResolvedRebaseCandidate {
  return captureNovelResolvedRebaseCandidate({
    sourceDraftSessionId: captureNovelDraftSessionId(row.source_draft_session_id),
    conflictedCandidateDraftSessionId: captureNovelDraftSessionId(row.conflicted_candidate_draft_session_id),
    resolutionPlanDigest: row.resolution_plan_digest as NovelResolvedRebaseCandidate["resolutionPlanDigest"],
    session: {
      id: captureNovelDraftSessionId(row.resolved_candidate_draft_session_id),
      novelId: captureNovelId(row.novel_id),
      ownerConversationId: captureNovelConversationId(row.owner_conversation_id),
      baseRevision: captureNovelRevision(row.candidate_base_revision),
      status: "rebasing",
      createdAt: captureNovelTimestamp(row.prepared_at),
      updatedAt: captureNovelTimestamp(row.prepared_at),
    },
    operationCount: row.operation_count,
    lastOperationSequence: row.last_operation_sequence,
    preparedAt: captureNovelTimestamp(row.prepared_at),
  });
}

function invalid(workspaceId: string, novelId: NovelId): NovelDatabaseError {
  return new NovelDatabaseError(NOVEL_DATABASE_FAILURE.invalidStructure, workspaceId, novelId);
}
function configure(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}
