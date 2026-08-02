/** Persists and validates Draft-local ChangeSet Approval grants. */
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_INVARIANT_FAILURE,
  NovelInvariantViolationError,
  canonicalizeNovelChangeSetApproval,
  canonicalizeNovelChangeSetApprovalContent,
  captureNovelApprovalDigest,
  captureNovelChangeSetApproval,
  captureNovelConversationId,
  captureNovelDraftSession,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelRevision,
  captureNovelTimestamp,
  type NovelApprovalInvalidationReason,
  type NovelApprovalStore,
  type NovelChangeSetApproval,
  type NovelDraftSession,
  type NovelDraftSessionId,
  type NovelId,
  type NovelTimestamp,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import { digestNovelApprovalText } from "./NodeSha256NovelApprovalDigester.js";
import { initializeNovelDraftSqliteSchema } from "./NovelDraftSqliteSchema.js";

const REASONS = new Set<unknown>(["superseded", "change-set-changed", "base-revision-changed", "draft-replaced", "revoked"]);
export interface SqliteNovelApprovalStoreOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly logger?: Logger;
}
export class SqliteNovelApprovalStore implements NovelApprovalStore {
  private readonly logger: Logger;
  constructor(private readonly options: SqliteNovelApprovalStoreOptions) {
    this.logger = (options.logger ?? noopLogger).child({ component: "sqlite_novel_approval_store", workspaceId: options.location.workspaceId, novelId: options.novelId });
  }
  async grantApproval(input: NovelChangeSetApproval): Promise<"recorded" | "duplicate"> {
    const approval = captureNovelChangeSetApproval(input);
    if (digestNovelApprovalText(canonicalizeNovelChangeSetApprovalContent(approval)) !== approval.digest) throw corrupt(approval.draftSessionId);
    const session = this.loadSession(approval.draftSessionId);
    const database = this.openDraft(session);
    let transaction = false;
    try {
      database.exec("BEGIN IMMEDIATE"); transaction = true;
      const existing = readActive(database, session);
      if (existing?.digest === approval.digest && canonicalizeNovelChangeSetApproval(existing) === canonicalizeNovelChangeSetApproval(approval)) {
        database.exec("COMMIT"); transaction = false; return "duplicate";
      }
      if (existing !== undefined) {
        database.prepare(`UPDATE draft_approvals SET status = 'invalidated', invalidated_at = ?, invalidation_reason = 'superseded' WHERE status = 'active'`).run(approval.grantedAt);
      }
      database.prepare(`INSERT INTO draft_approvals(approval_digest, approval_json, base_revision, change_set_digest, status, granted_at, invalidated_at, invalidation_reason) VALUES (?, ?, ?, ?, 'active', ?, NULL, NULL)`).run(
        approval.digest, canonicalizeNovelChangeSetApproval(approval), approval.baseRevision, approval.changeSetDigest, approval.grantedAt,
      );
      database.exec("COMMIT"); transaction = false;
      this.logger.info("novel_approval_store.granted", { draftSessionId: session.id, operationCount: approval.operationIds.length });
      return "recorded";
    } catch (error) {
      if (transaction) try { database.exec("ROLLBACK"); } catch {}
      if (error instanceof NovelInvariantViolationError) throw error;
      throw corrupt(session.id);
    } finally { database.close(); }
  }
  async getActiveApproval(draftSessionId: NovelDraftSessionId): Promise<NovelChangeSetApproval | undefined> {
    const session = this.loadSession(draftSessionId);
    const database = this.openDraft(session, true);
    try { return readActive(database, session); }
    catch { throw corrupt(session.id); }
    finally { database.close(); }
  }
  async invalidateApproval(sessionInput: NovelDraftSession, reasonInput: NovelApprovalInvalidationReason, invalidatedAtInput: NovelTimestamp): Promise<"invalidated" | "absent"> {
    const session = captureNovelDraftSession(sessionInput);
    const reason = captureReason(reasonInput);
    const invalidatedAt = captureNovelTimestamp(invalidatedAtInput);
    const database = this.openDraft(session);
    try {
      const result = database.prepare(`UPDATE draft_approvals SET status = 'invalidated', invalidated_at = ?, invalidation_reason = ? WHERE status = 'active'`).run(invalidatedAt, reason);
      return Number(result.changes) === 1 ? "invalidated" : "absent";
    } catch { throw corrupt(session.id); }
    finally { database.close(); }
  }
  private loadSession(idInput: NovelDraftSessionId): NovelDraftSession {
    const id = captureNovelDraftSessionId(idInput);
    const database = new DatabaseSync(this.options.location.canonicalDatabasePath, { readOnly: true });
    try {
      const row = database.prepare(`SELECT novel_id, owner_conversation_id, base_revision, status, created_at, updated_at, terminal_at FROM novel_draft_sessions WHERE id = ?`).get(id) as {
        novel_id: string;
        owner_conversation_id: string;
        base_revision: string;
        status: NovelDraftSession["status"];
        created_at: string;
        updated_at: string;
        terminal_at: string | null;
      } | undefined;
      if (row === undefined || row.novel_id !== this.options.novelId) throw new Error();
      return captureNovelDraftSession({ id, novelId: captureNovelId(row.novel_id), ownerConversationId: captureNovelConversationId(row.owner_conversation_id), baseRevision: captureNovelRevision(row.base_revision), status: row.status, createdAt: captureNovelTimestamp(row.created_at), updatedAt: captureNovelTimestamp(row.updated_at), ...(row.terminal_at === null ? {} : { terminalAt: captureNovelTimestamp(row.terminal_at) }) });
    } catch { throw corrupt(id); }
    finally { database.close(); }
  }
  private openDraft(session: NovelDraftSession, readOnly = false): DatabaseSync {
    initializeNovelDraftSqliteSchema(join(this.options.location.stagingDir, session.ownerConversationId, session.id, "draft.sqlite"), session);
    return new DatabaseSync(join(this.options.location.stagingDir, session.ownerConversationId, session.id, "draft.sqlite"), { readOnly });
  }
}
function readActive(database: DatabaseSync, session: NovelDraftSession): NovelChangeSetApproval | undefined {
  const row = database.prepare(`SELECT approval_json, approval_digest FROM draft_approvals WHERE status = 'active'`).get() as { approval_json: string; approval_digest: string } | undefined;
  if (row === undefined) return undefined;
  const approval = captureNovelChangeSetApproval(JSON.parse(row.approval_json));
  if (approval.draftSessionId !== session.id || approval.digest !== captureNovelApprovalDigest(row.approval_digest) || canonicalizeNovelChangeSetApproval(approval) !== row.approval_json || digestNovelApprovalText(canonicalizeNovelChangeSetApprovalContent(approval)) !== approval.digest) throw corrupt(session.id);
  return approval;
}
function captureReason(value: NovelApprovalInvalidationReason): NovelApprovalInvalidationReason {
  if (!REASONS.has(value)) throw new TypeError();
  return value;
}
function corrupt(id: NovelDraftSessionId): NovelInvariantViolationError {
  return new NovelInvariantViolationError(NOVEL_INVARIANT_FAILURE.persistenceInvariant, undefined, id);
}
