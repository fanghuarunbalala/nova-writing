/** Encodes one validated lifecycle Record for durable SQLite Outbox storage. */
import type { DatabaseSync } from "node:sqlite";
import {
  NOVEL_LIFECYCLE_RECORD_VERSION,
  canonicalizeNovelLifecycleRecord,
  captureNovelLifecycleRecord,
  captureNovelOutboxRecordDigest,
  type NovelLifecycleRecord,
  type NovelOutboxRecordDigest,
} from "../../../novel/index.js";
import { digestNovelSha256Text } from "./NodeSha256NovelOperationDigester.js";

export interface NodeNovelLifecycleOutboxEnvelope {
  readonly eventId: string;
  readonly eventType: string;
  readonly schemaVersion: typeof NOVEL_LIFECYCLE_RECORD_VERSION;
  readonly eventJson: string;
  readonly eventDigest: NovelOutboxRecordDigest;
  readonly createdAt: string;
}

export function encodeNovelLifecycleOutboxRecord(
  recordInput: NovelLifecycleRecord,
): NodeNovelLifecycleOutboxEnvelope {
  const record = captureNovelLifecycleRecord(recordInput);
  const eventJson = canonicalizeNovelLifecycleRecord(record);
  return Object.freeze({
    eventId: record.eventId,
    eventType: `novel.${record.eventType}`,
    schemaVersion: NOVEL_LIFECYCLE_RECORD_VERSION,
    eventJson,
    eventDigest: digestNovelLifecycleOutboxText(eventJson),
    createdAt: record.occurredAt,
  });
}

export function digestNovelLifecycleOutboxText(
  canonicalText: string,
): NovelOutboxRecordDigest {
  return captureNovelOutboxRecordDigest(
    digestNovelSha256Text(canonicalText),
  );
}

export function insertNovelLifecycleOutboxRecord(
  database: DatabaseSync,
  recordInput: NovelLifecycleRecord,
): NodeNovelLifecycleOutboxEnvelope {
  const record = captureNovelLifecycleRecord(recordInput);
  const outbox = encodeNovelLifecycleOutboxRecord(record);
  database.prepare(
    `INSERT INTO novel_outbox(
       event_id, novel_id, conversation_id, event_type, schema_version,
       event_json, event_digest, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    outbox.eventId,
    record.novelId,
    record.conversationId,
    outbox.eventType,
    outbox.schemaVersion,
    outbox.eventJson,
    outbox.eventDigest,
    outbox.createdAt,
  );
  return outbox;
}

export function insertDraftNovelLifecycleOutboxRecord(
  database: DatabaseSync,
  recordInput: NovelLifecycleRecord,
): NodeNovelLifecycleOutboxEnvelope {
  const record = captureNovelLifecycleRecord(recordInput);
  const outbox = encodeNovelLifecycleOutboxRecord(record);
  database.prepare(
    `INSERT INTO draft_outbox(
       event_id, novel_id, conversation_id, operation_sequence, operation_id,
       event_type, schema_version, event_json, event_digest, created_at
     ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
  ).run(
    outbox.eventId,
    record.novelId,
    record.conversationId,
    outbox.eventType,
    outbox.schemaVersion,
    outbox.eventJson,
    outbox.eventDigest,
    outbox.createdAt,
  );
  return outbox;
}
