/** Encodes one validated lifecycle Record for durable SQLite Outbox storage. */
import {
  NOVEL_LIFECYCLE_RECORD_VERSION,
  canonicalizeNovelLifecycleRecord,
  captureNovelLifecycleRecord,
  type NovelLifecycleRecord,
} from "../../../novel/index.js";
import { digestNovelSha256Text } from "./NodeSha256NovelOperationDigester.js";

export interface NodeNovelLifecycleOutboxEnvelope {
  readonly eventId: string;
  readonly eventType: string;
  readonly schemaVersion: typeof NOVEL_LIFECYCLE_RECORD_VERSION;
  readonly eventJson: string;
  readonly eventDigest: string;
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
    eventDigest: digestNovelSha256Text(eventJson),
    createdAt: record.occurredAt,
  });
}
