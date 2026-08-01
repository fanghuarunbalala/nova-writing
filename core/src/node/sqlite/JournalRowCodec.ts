import { createHash } from "node:crypto";
import type { EventSchemaRegistry, JsonValue } from "../../event/index.js";
import { canonicalStringifyJson, isJsonValue } from "../../event/index.js";
import type {
  JournalAppendRequest,
  PersistedConversationEventSnapshot,
} from "../../storage/index.js";
import { JournalRecordCorruptedError } from "../../storage/index.js";

export interface JournalRecordRow {
  conversation_id: string;
  sequence: number;
  event_id: string;
  event_direction: "input" | "output";
  event_type: string;
  schema_version: number;
  event_timestamp: string;
  recorded_at: string;
  run_id: string | null;
  turn_id: string | null;
  correlation_id: string | null;
  causation_id: string | null;
  event_json: string;
  event_hash: string;
}

export interface PreparedJournalRecord {
  conversationId: string;
  eventId: string;
  direction: "input" | "output";
  eventType: string;
  schemaVersion: number;
  eventTimestamp: string;
  runId: string | null;
  turnId: string | null;
  correlationId: string | null;
  causationId: string | null;
  eventJson: string;
  eventHash: string;
}

export function prepareJournalRecord(
  request: JournalAppendRequest,
  registry: EventSchemaRegistry,
): PreparedJournalRecord {
  const snapshot =
    request.direction === "input"
      ? registry.validateInput(request.snapshot)
      : registry.validateOutput(request.snapshot, { allowUnknownEventType: true });
  const eventJson = canonicalStringifyJson(snapshot as unknown as JsonValue);

  return {
    conversationId: snapshot.conversationId,
    eventId: snapshot.id,
    direction: request.direction,
    eventType: snapshot.eventType,
    schemaVersion: snapshot.schemaVersion,
    eventTimestamp: snapshot.timestamp,
    runId: snapshot.runId ?? null,
    turnId: snapshot.turnId ?? null,
    correlationId: snapshot.correlationId ?? null,
    causationId: snapshot.causationId ?? null,
    eventJson,
    eventHash: hashJournalJson(eventJson),
  };
}

export function decodeJournalRow(
  row: JournalRecordRow,
  registry: EventSchemaRegistry,
): PersistedConversationEventSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(row.event_json);
  } catch (error) {
    throw corrupted(row, "Journal event JSON cannot be parsed", error);
  }

  if (!isJsonValue(value)) {
    throw corrupted(row, "Journal event JSON is not JSON-safe");
  }

  const canonicalJson = canonicalStringifyJson(value);
  if (canonicalJson !== row.event_json) {
    throw corrupted(row, "Journal event JSON is not canonical");
  }
  if (hashJournalJson(canonicalJson) !== row.event_hash) {
    throw corrupted(row, "Journal event hash does not match its JSON");
  }

  let snapshot;
  try {
    snapshot =
      row.event_direction === "input"
        ? registry.validateInput(value, { allowUnknownEventType: true })
        : registry.validateOutput(value, { allowUnknownEventType: true });
  } catch (error) {
    throw corrupted(row, "Journal event envelope is invalid", error);
  }

  assertExtractedColumns(row, snapshot);

  if (!Number.isInteger(row.sequence) || row.sequence <= 0) {
    throw corrupted(row, "Journal sequence is invalid");
  }
  if (Number.isNaN(Date.parse(row.recorded_at))) {
    throw corrupted(row, "Journal recorded timestamp is invalid");
  }

  return {
    ...snapshot,
    direction: row.event_direction,
    sequence: row.sequence,
    recordedAt: row.recorded_at,
  } as PersistedConversationEventSnapshot;
}

function assertExtractedColumns(
  row: JournalRecordRow,
  snapshot: {
    id: string;
    conversationId: string;
    eventType: string;
    schemaVersion: number;
    timestamp: string;
    runId?: string;
    turnId?: string;
    correlationId?: string;
    causationId?: string;
  },
): void {
  const matches =
    snapshot.id === row.event_id &&
    snapshot.conversationId === row.conversation_id &&
    snapshot.eventType === row.event_type &&
    snapshot.schemaVersion === row.schema_version &&
    snapshot.timestamp === row.event_timestamp &&
    (snapshot.runId ?? null) === row.run_id &&
    (snapshot.turnId ?? null) === row.turn_id &&
    (snapshot.correlationId ?? null) === row.correlation_id &&
    (snapshot.causationId ?? null) === row.causation_id;

  if (!matches) {
    throw corrupted(row, "Journal extracted columns do not match event JSON");
  }
}

function hashJournalJson(eventJson: string): string {
  return createHash("sha256").update(eventJson, "utf8").digest("hex");
}

function corrupted(row: JournalRecordRow, message: string, cause?: unknown): JournalRecordCorruptedError {
  return new JournalRecordCorruptedError(message, row.conversation_id, row.sequence, {
    ...(cause !== undefined ? { cause } : {}),
  });
}
