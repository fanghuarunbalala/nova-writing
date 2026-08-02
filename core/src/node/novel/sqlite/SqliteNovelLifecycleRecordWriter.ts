/** Idempotently appends validated lifecycle Records to canonical Novel Outbox. */
import { DatabaseSync } from "node:sqlite";
import {
  canonicalizeNovelLifecycleRecord,
  captureNovelId,
  captureNovelLifecycleRecord,
  captureNovelWorkspaceId,
  type NovelId,
  type NovelLifecycleRecord,
  type NovelLifecycleRecordWriter,
} from "../../../novel/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import { NOVEL_DATABASE_FAILURE, NovelDatabaseError } from "./NovelDatabaseErrors.js";
import { encodeNovelLifecycleOutboxRecord, insertNovelLifecycleOutboxRecord } from "./NodeNovelLifecycleOutboxEncoder.js";

export class SqliteNovelLifecycleRecordWriter implements NovelLifecycleRecordWriter {
  private readonly novelId: NovelId;
  private readonly workspaceId: string;

  constructor(private readonly location: NodeNovelStoreLocation, novelId: NovelId) {
    this.novelId = captureNovelId(novelId);
    this.workspaceId = captureNovelWorkspaceId(location.workspaceId);
  }

  async recordCanonical(recordInput: NovelLifecycleRecord): Promise<"recorded" | "duplicate"> {
    const record = captureNovelLifecycleRecord(recordInput);
    if (record.novelId !== this.novelId) throw invalid(this.workspaceId, this.novelId);
    const expected = encodeNovelLifecycleOutboxRecord(record);
    const database = new DatabaseSync(this.location.canonicalDatabasePath);
    try {
      configure(database);
      database.exec("BEGIN IMMEDIATE");
      const existing = database.prepare(
        `SELECT novel_id, conversation_id, event_type, schema_version,
                event_json, event_digest, created_at
         FROM novel_outbox WHERE event_id = ?`,
      ).get(record.eventId) as Record<string, unknown> | undefined;
      if (existing !== undefined) {
        if (
          existing.novel_id !== record.novelId ||
          existing.conversation_id !== record.conversationId ||
          existing.event_type !== expected.eventType ||
          existing.schema_version !== expected.schemaVersion ||
          existing.event_json !== canonicalizeNovelLifecycleRecord(record) ||
          existing.event_digest !== expected.eventDigest ||
          existing.created_at !== record.occurredAt
        ) throw invalid(this.workspaceId, this.novelId);
        database.exec("COMMIT");
        return "duplicate";
      }
      insertNovelLifecycleOutboxRecord(database, record);
      database.exec("COMMIT");
      return "recorded";
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch {}
      if (error instanceof NovelDatabaseError) throw error;
      throw invalid(this.workspaceId, this.novelId);
    } finally {
      database.close();
    }
  }
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
