/** Persists Conversation-to-Novel bindings in canonical Novel SQLite. */
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_DRAFT_SESSION_STATUS,
  captureConversationNovelBinding,
  captureNovelConversationId,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelTimestamp,
  captureNovelWorkspaceId,
  type BindConversationActiveDraftInput,
  type BindConversationNovelInput,
  type ClearConversationActiveDraftInput,
  type ConversationNovelBinding,
  type ConversationNovelBindingStore,
  type NovelId,
} from "../../../novel/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import { NOVEL_DATABASE_FAILURE, NovelDatabaseError } from "./NovelDatabaseErrors.js";

interface Row {
  conversation_id: string;
  novel_id: string;
  active_draft_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export class SqliteConversationNovelBindingStore implements ConversationNovelBindingStore {
  private closed = false;
  private constructor(
    private readonly database: DatabaseSync,
    private readonly novelId: NovelId,
    private readonly workspaceId: string,
  ) {}

  static async open(options: { readonly location: NodeNovelStoreLocation; readonly novelId: NovelId }) {
    const novelId = captureNovelId(options.novelId);
    const workspaceId = captureNovelWorkspaceId(options.location.workspaceId);
    const database = new DatabaseSync(options.location.canonicalDatabasePath);
    configure(database);
    const metadata = database.prepare(
      "SELECT novel_id, workspace_id FROM novel_metadata WHERE singleton = 1",
    ).get() as { novel_id: string; workspace_id: string } | undefined;
    if (metadata?.novel_id !== novelId || metadata.workspace_id !== workspaceId) {
      database.close();
      throw invalid(workspaceId, novelId);
    }
    database.prepare("SELECT conversation_id FROM novel_conversation_bindings LIMIT 0");
    return new SqliteConversationNovelBindingStore(database, novelId, workspaceId);
  }

  async bind(input: BindConversationNovelInput): Promise<ConversationNovelBinding> {
    this.assertIdentity(input.novelId);
    const conversationId = captureNovelConversationId(input.conversationId);
    const boundAt = captureNovelTimestamp(input.boundAt);
    this.database.prepare(
      `INSERT INTO novel_conversation_bindings(
         conversation_id, novel_id, active_draft_session_id, created_at, updated_at
       ) VALUES (?, ?, NULL, ?, ?)
       ON CONFLICT(conversation_id) DO NOTHING`,
    ).run(conversationId, this.novelId, boundAt, boundAt);
    return this.require(conversationId);
  }

  async bindActiveDraft(input: BindConversationActiveDraftInput): Promise<ConversationNovelBinding> {
    this.assertIdentity(input.novelId);
    const conversationId = captureNovelConversationId(input.conversationId);
    const draftSessionId = captureNovelDraftSessionId(input.draftSessionId);
    const boundAt = captureNovelTimestamp(input.boundAt);
    const draft = this.database.prepare(
      `SELECT owner_conversation_id, status FROM novel_draft_sessions
       WHERE novel_id = ? AND id = ?`,
    ).get(this.novelId, draftSessionId) as { owner_conversation_id: string; status: string } | undefined;
    if (
      draft?.owner_conversation_id !== conversationId ||
      !ACTIVE_DRAFT_STATUSES.has(draft.status)
    ) throw invalid(this.workspaceId, this.novelId);
    this.database.prepare(
      `INSERT INTO novel_conversation_bindings(
         conversation_id, novel_id, active_draft_session_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         active_draft_session_id = excluded.active_draft_session_id,
         updated_at = excluded.updated_at
       WHERE novel_conversation_bindings.novel_id = excluded.novel_id`,
    ).run(conversationId, this.novelId, draftSessionId, boundAt, boundAt);
    return this.require(conversationId);
  }

  async clearActiveDraft(input: ClearConversationActiveDraftInput): Promise<ConversationNovelBinding> {
    this.assertIdentity(input.novelId);
    const conversationId = captureNovelConversationId(input.conversationId);
    const result = this.database.prepare(
      `UPDATE novel_conversation_bindings
       SET active_draft_session_id = NULL, updated_at = ?
       WHERE novel_id = ? AND conversation_id = ? AND active_draft_session_id = ?`,
    ).run(
      captureNovelTimestamp(input.clearedAt),
      this.novelId,
      conversationId,
      captureNovelDraftSessionId(input.expectedDraftSessionId),
    );
    if (Number(result.changes) !== 1) throw invalid(this.workspaceId, this.novelId);
    return this.require(conversationId);
  }

  async getBinding(novelId: NovelId, conversationId: string) {
    this.assertIdentity(novelId);
    const row = this.database.prepare(
      `${SELECT} WHERE novel_id = ? AND conversation_id = ?`,
    ).get(this.novelId, captureNovelConversationId(conversationId)) as Row | undefined;
    return row === undefined ? undefined : captureRow(row);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  private require(conversationId: string): ConversationNovelBinding {
    const row = this.database.prepare(
      `${SELECT} WHERE novel_id = ? AND conversation_id = ?`,
    ).get(this.novelId, conversationId) as Row | undefined;
    if (row === undefined) throw invalid(this.workspaceId, this.novelId);
    return captureRow(row);
  }

  private assertIdentity(novelId: NovelId): void {
    if (this.closed || captureNovelId(novelId) !== this.novelId) {
      throw invalid(this.workspaceId, this.novelId);
    }
  }
}

const ACTIVE_DRAFT_STATUSES = new Set<string>([
  NOVEL_DRAFT_SESSION_STATUS.active,
  NOVEL_DRAFT_SESSION_STATUS.awaitingApproval,
  NOVEL_DRAFT_SESSION_STATUS.rebasing,
  NOVEL_DRAFT_SESSION_STATUS.committing,
]);
const SELECT = `SELECT conversation_id, novel_id, active_draft_session_id,
  created_at, updated_at FROM novel_conversation_bindings`;

function captureRow(row: Row): ConversationNovelBinding {
  return captureConversationNovelBinding({
    conversationId: row.conversation_id,
    novelId: captureNovelId(row.novel_id),
    ...(row.active_draft_session_id === null
      ? {}
      : { activeDraftSessionId: captureNovelDraftSessionId(row.active_draft_session_id) }),
    createdAt: captureNovelTimestamp(row.created_at),
    updatedAt: captureNovelTimestamp(row.updated_at),
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
