/** Canonical SQLite transaction for replaying and recording one frozen ChangeSet. */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canonicalStringifyJson } from "../../../event/index.js";
import {
  NOVEL_INVARIANT_FAILURE,
  NovelCommitIdentityConflictError,
  NovelInvariantViolationError,
  NovelOperationPreconditionError,
  NovelProtocolValidationError,
  NovelRevisionConflictError,
  captureNovelChangeSet,
  captureNovelCommit,
  captureNovelCommitId,
  captureNovelCommitPayloadDigest,
  captureNovelCommitPayloadRef,
  captureNovelId,
  captureNovelRevision,
  type CommitNovelChangeSetInput,
  type NovelCommitHistoryReference,
  type NovelCommitStore,
  type NovelId,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";

interface CommitRow {
  commit_id: string;
  novel_id: string;
  draft_session_id: string;
  owner_conversation_id: string;
  base_revision: string;
  result_revision: string;
  change_set_digest: string;
  payload_ref: string | null;
  payload_digest: string | null;
  payload_size: number | null;
  committed_at: string;
}

export interface SqliteNovelCommitStoreOptions<TContext> {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly contextFactory: (database: DatabaseSync) => TContext;
  readonly logger?: Logger;
}

export class SqliteNovelCommitStore<TContext>
  implements NovelCommitStore<TContext>
{
  private readonly novelId: NovelId;
  private readonly logger: Logger;

  constructor(private readonly options: SqliteNovelCommitStoreOptions<TContext>) {
    this.novelId = captureNovelId(options.novelId);
    this.logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_commit_store",
      workspaceId: options.location.workspaceId,
      novelId: this.novelId,
    });
  }

  async listHistoryReferences(): Promise<readonly NovelCommitHistoryReference[]> {
    const database = new DatabaseSync(
      this.options.location.canonicalDatabasePath,
      { readOnly: true },
    );
    try {
      configureRead(database);
      const rows = database
        .prepare(
          `SELECT commit_id, payload_ref, payload_digest, payload_size
           FROM novel_commits
           WHERE novel_id = ? AND payload_ref IS NOT NULL
             AND payload_digest IS NOT NULL AND payload_size IS NOT NULL
           ORDER BY committed_at, commit_id`,
        )
        .all(this.novelId) as unknown as Array<{
          commit_id: string;
          payload_ref: string;
          payload_digest: string;
          payload_size: number;
        }>;
      return Object.freeze(rows.map((row) => Object.freeze({
        commitId: captureNovelCommitId(row.commit_id),
        payloadRef: captureNovelCommitPayloadRef(row.payload_ref),
        payloadDigest: captureNovelCommitPayloadDigest(row.payload_digest),
        payloadSize: capturePayloadSize(row.payload_size),
      })));
    } finally {
      database.close();
    }
  }

  async commit(input: CommitNovelChangeSetInput<TContext>): Promise<"committed" | "duplicate"> {
    const commit = captureNovelCommit(input.commit);
    const changeSet = captureNovelChangeSet(input.changeSet);
    assertCommitMatchesChangeSet(commit, changeSet);
    let database: DatabaseSync | undefined;
    let transactionStarted = false;
    try {
      database = new DatabaseSync(this.options.location.canonicalDatabasePath);
      configure(database);
      database.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      const existing = readCommit(database, commit.commitId);
      if (existing !== undefined) {
        if (!matchesCommit(existing, commit)) {
          throw new NovelCommitIdentityConflictError(commit.commitId);
        }
        database.exec("COMMIT");
        transactionStarted = false;
        return "duplicate";
      }
      const metadata = database
        .prepare("SELECT novel_id, current_revision FROM novel_metadata WHERE singleton = 1")
        .get() as { novel_id: string; current_revision: string } | undefined;
      if (metadata?.novel_id !== this.novelId) throw invariant(commit);
      const actualRevision = captureNovelRevision(metadata.current_revision);
      if (actualRevision !== commit.baseRevision) {
        throw new NovelRevisionConflictError(
          commit.novelId,
          commit.baseRevision,
          actualRevision,
          commit.draftSessionId,
        );
      }
      if (commit.resultRevision === commit.baseRevision) throw invariant(commit);
      const draft = database
        .prepare(
          `SELECT novel_id, owner_conversation_id, base_revision, status
           FROM novel_draft_sessions WHERE id = ?`,
        )
        .get(commit.draftSessionId) as
        | { novel_id: string; owner_conversation_id: string; base_revision: string; status: string }
        | undefined;
      if (
        draft?.novel_id !== commit.novelId ||
        draft.owner_conversation_id !== commit.ownerConversationId ||
        draft.base_revision !== commit.baseRevision ||
        !["active", "awaiting-approval", "committing"].includes(draft.status)
      ) throw invariant(commit);

      const context = this.options.contextFactory(database);
      input.apply(context);
      input.validate(context);
      database
        .prepare(
          `INSERT INTO novel_commits(
             commit_id, novel_id, draft_session_id, owner_conversation_id,
             base_revision, result_revision, change_set_digest, payload_ref,
             payload_digest, payload_size, committed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          commit.commitId,
          commit.novelId,
          commit.draftSessionId,
          commit.ownerConversationId,
          commit.baseRevision,
          commit.resultRevision,
          commit.changeSetDigest,
          commit.payloadRef,
          commit.payloadDigest,
          commit.payloadSize,
          commit.committedAt,
        );
      const metadataUpdate = database
        .prepare(
          `UPDATE novel_metadata SET current_revision = ?, updated_at = ?
           WHERE singleton = 1 AND novel_id = ? AND current_revision = ?`,
        )
        .run(
          commit.resultRevision,
          commit.committedAt,
          commit.novelId,
          commit.baseRevision,
        );
      if (Number(metadataUpdate.changes) !== 1) throw invariant(commit);
      const draftUpdate = database
        .prepare(
          `UPDATE novel_draft_sessions
           SET status = 'committed', updated_at = ?, terminal_at = ?
           WHERE id = ? AND novel_id = ?
             AND status IN ('active', 'awaiting-approval', 'committing')`,
        )
        .run(
          commit.committedAt,
          commit.committedAt,
          commit.draftSessionId,
          commit.novelId,
        );
      if (Number(draftUpdate.changes) !== 1) throw invariant(commit);
      const eventJson = canonicalStringifyJson({
        commitId: commit.commitId,
        draftSessionId: commit.draftSessionId,
        novelId: commit.novelId,
        baseRevision: commit.baseRevision,
        resultRevision: commit.resultRevision,
        changeSetDigest: commit.changeSetDigest,
      });
      database
        .prepare(
          `INSERT INTO novel_outbox(
             event_id, novel_id, conversation_id, event_type, schema_version,
             event_json, event_digest, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `novel-commit:${commit.commitId}`,
          commit.novelId,
          commit.ownerConversationId,
          "novel.commit.completed",
          1,
          eventJson,
          digestText(eventJson),
          commit.committedAt,
        );
      database.exec("COMMIT");
      transactionStarted = false;
      this.logger.info("novel_commit.transaction.completed", {
        novelId: commit.novelId,
        draftSessionId: commit.draftSessionId,
        commitId: commit.commitId,
        resultRevision: commit.resultRevision,
      });
      return "committed";
    } catch (error) {
      if (transactionStarted) {
        try { database?.exec("ROLLBACK"); } catch {}
      }
      this.logger.info("novel_commit.transaction.failed", {
        novelId: commit.novelId,
        draftSessionId: commit.draftSessionId,
        commitId: commit.commitId,
      });
      if (isSafeCommitError(error)) throw error;
      throw invariant(commit);
    } finally {
      try { database?.close(); } catch {}
    }
  }
}

function readCommit(database: DatabaseSync, commitId: string): CommitRow | undefined {
  return database
    .prepare(
      `SELECT commit_id, novel_id, draft_session_id, owner_conversation_id,
              base_revision, result_revision, change_set_digest, payload_ref,
              payload_digest, payload_size, committed_at
       FROM novel_commits WHERE commit_id = ?`,
    )
    .get(commitId) as CommitRow | undefined;
}

function matchesCommit(row: CommitRow, commit: ReturnType<typeof captureNovelCommit>): boolean {
  return row.commit_id === commit.commitId &&
    row.novel_id === commit.novelId &&
    row.draft_session_id === commit.draftSessionId &&
    row.owner_conversation_id === commit.ownerConversationId &&
    row.base_revision === commit.baseRevision &&
    row.result_revision === commit.resultRevision &&
    row.change_set_digest === commit.changeSetDigest &&
    row.payload_ref === commit.payloadRef &&
    row.payload_digest === commit.payloadDigest &&
    row.payload_size === commit.payloadSize &&
    row.committed_at === commit.committedAt;
}

function assertCommitMatchesChangeSet(
  commit: ReturnType<typeof captureNovelCommit>,
  changeSet: ReturnType<typeof captureNovelChangeSet>,
): void {
  if (
    commit.novelId !== changeSet.novelId ||
    commit.draftSessionId !== changeSet.draftSessionId ||
    commit.baseRevision !== changeSet.baseRevision ||
    commit.changeSetDigest !== changeSet.digest
  ) throw invariant(commit);
}

function isSafeCommitError(error: unknown): boolean {
  return error instanceof NovelRevisionConflictError ||
    error instanceof NovelCommitIdentityConflictError ||
    error instanceof NovelInvariantViolationError ||
    error instanceof NovelOperationPreconditionError ||
    error instanceof NovelProtocolValidationError;
}

function invariant(commit: { novelId: NovelId; draftSessionId: string }): NovelInvariantViolationError {
  return new NovelInvariantViolationError(
    NOVEL_INVARIANT_FAILURE.persistenceInvariant,
    commit.novelId,
    commit.draftSessionId as never,
  );
}

function capturePayloadSize(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error();
  return value as number;
}

function digestText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function configure(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}

function configureRead(database: DatabaseSync): void {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}
