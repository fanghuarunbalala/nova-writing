import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { isEventType, type EventKind, type EventSchemaRegistry } from "../../event/index.js";
import type {
  ConversationEventPage,
  ConversationEventQuery,
  ConversationJournalStore,
  JournalAppendReceipt,
  JournalAppendRequest,
  PersistedConversationEventSnapshot,
} from "../../storage/index.js";
import {
  ConversationEventQueryError,
  JournalConversationNotFoundError,
  JournalEventConflictError,
  JournalRecordCorruptedError,
} from "../../storage/index.js";
import {
  decodeJournalRow,
  prepareJournalRecord,
  type JournalRecordRow,
  type PreparedJournalRecord,
} from "./JournalRowCodec.js";

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 1000;

interface ConversationSequenceRow {
  last_journal_sequence: number;
}

interface QueryPlan {
  whereSql: string;
  parameters: SQLInputValue[];
  descending: boolean;
  limit: number;
  highWatermark: number;
}

export class SqliteConversationJournalStore implements ConversationJournalStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly registry: EventSchemaRegistry,
    private readonly assertOpen: () => void,
  ) {}

  async append(request: JournalAppendRequest): Promise<JournalAppendReceipt> {
    this.assertOpen();
    const prepared = prepareJournalRecord(request, this.registry);
    const recordedAt = new Date().toISOString();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const conversation = this.selectConversationSequence(prepared.conversationId);
      if (conversation === undefined) {
        throw new JournalConversationNotFoundError(prepared.conversationId);
      }

      const existing = this.selectExistingEvent(prepared.conversationId, prepared.eventId);
      if (existing !== undefined) {
        if (existing.event_json === prepared.eventJson) {
          if (existing.event_hash !== prepared.eventHash || !this.columnsMatch(existing, prepared)) {
            throw new JournalRecordCorruptedError(
              "Existing journal columns or hash do not match event JSON",
              existing.conversation_id,
              existing.sequence,
            );
          }
          if (existing.event_direction !== prepared.direction) {
            throw new JournalEventConflictError(
              prepared.conversationId,
              prepared.eventId,
              existing.event_direction,
              prepared.direction,
            );
          }

          this.database.exec("COMMIT");
          return {
            status: "duplicate",
            conversationId: prepared.conversationId,
            eventId: prepared.eventId,
            direction: prepared.direction,
            sequence: existing.sequence,
            recordedAt: existing.recorded_at,
          };
        }

        throw new JournalEventConflictError(
          prepared.conversationId,
          prepared.eventId,
          existing.event_direction,
          prepared.direction,
        );
      }

      const sequence = conversation.last_journal_sequence + 1;
      this.insertJournalRecord(prepared, sequence, recordedAt);
      const update = this.database
        .prepare(
          `UPDATE conversations
           SET last_journal_sequence = ?
           WHERE id = ? AND last_journal_sequence = ?`,
        )
        .run(sequence, prepared.conversationId, conversation.last_journal_sequence);
      if (Number(update.changes) !== 1) {
        throw new Error(`Failed to advance journal sequence for ${prepared.conversationId}`);
      }

      this.database.exec("COMMIT");
      return {
        status: "appended",
        conversationId: prepared.conversationId,
        eventId: prepared.eventId,
        direction: prepared.direction,
        sequence,
        recordedAt,
      };
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }

  async getHighWatermark(conversationId: string): Promise<number> {
    this.assertOpen();
    this.assertIdentifier("conversationId", conversationId);
    return this.requireConversationSequence(conversationId).last_journal_sequence;
  }

  async getBySequence(
    conversationId: string,
    sequence: number,
  ): Promise<PersistedConversationEventSnapshot | undefined> {
    this.assertOpen();
    this.assertIdentifier("conversationId", conversationId);
    this.assertSequence("sequence", sequence, 1);
    this.requireConversationSequence(conversationId);
    const row = this.database
      .prepare("SELECT * FROM journal_records WHERE conversation_id = ? AND sequence = ?")
      .get(conversationId, sequence) as JournalRecordRow | undefined;
    return row === undefined ? undefined : decodeJournalRow(row, this.registry);
  }

  async getByEventId(
    conversationId: string,
    eventId: string,
  ): Promise<PersistedConversationEventSnapshot | undefined> {
    this.assertOpen();
    this.assertIdentifier("conversationId", conversationId);
    this.assertIdentifier("eventId", eventId);
    this.requireConversationSequence(conversationId);
    const row = this.database
      .prepare("SELECT * FROM journal_records WHERE conversation_id = ? AND event_id = ?")
      .get(conversationId, eventId) as JournalRecordRow | undefined;
    return row === undefined ? undefined : decodeJournalRow(row, this.registry);
  }

  async list(query: ConversationEventQuery): Promise<ConversationEventPage> {
    this.assertOpen();
    const plan = this.createQueryPlan(query);
    const rows = this.database
      .prepare(
        `SELECT * FROM journal_records
         WHERE ${plan.whereSql}
         ORDER BY sequence ${plan.descending ? "DESC" : "ASC"}
         LIMIT ?`,
      )
      .all(...plan.parameters, plan.limit) as unknown as JournalRecordRow[];

    if (plan.descending) rows.reverse();
    const events = rows.map((row) => decodeJournalRow(row, this.registry));
    const firstSequence = events[0]?.sequence;
    const lastSequence = events.at(-1)?.sequence;

    return {
      events,
      highWatermark: plan.highWatermark,
      hasPrevious:
        firstSequence === undefined
          ? this.hasPreviousForEmptyPage(query, plan)
          : this.existsMatching(plan, "sequence < ?", firstSequence),
      hasNext:
        lastSequence === undefined
          ? this.hasNextForEmptyPage(query, plan)
          : this.existsMatching(plan, "sequence > ?", lastSequence),
    };
  }

  private createQueryPlan(query: ConversationEventQuery): QueryPlan {
    this.assertIdentifier("conversationId", query.conversationId);
    const currentHighWatermark = this.requireConversationSequence(
      query.conversationId,
    ).last_journal_sequence;
    const throughSequence =
      query.throughSequence === undefined
        ? currentHighWatermark
        : this.assertSequence("throughSequence", query.throughSequence, 0);
    const highWatermark = Math.min(currentHighWatermark, throughSequence);
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
      throw new ConversationEventQueryError(
        `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`,
      );
    }

    const conditions = ["conversation_id = ?", "sequence <= ?"];
    const parameters: SQLInputValue[] = [query.conversationId, highWatermark];
    let descending = false;
    const anchor = query.anchor as ConversationEventQuery["anchor"] | undefined;

    if (anchor === undefined || typeof anchor !== "object" || anchor === null) {
      throw new ConversationEventQueryError("anchor is required");
    }
    if (Object.keys(anchor).length !== 1) {
      throw new ConversationEventQueryError("anchor must contain exactly one cursor");
    }
    if ("from" in anchor) {
      if (anchor.from !== "start" && anchor.from !== "end") {
        throw new ConversationEventQueryError("anchor.from must be start or end");
      }
      descending = anchor.from === "end";
    } else if ("afterSequence" in anchor) {
      conditions.push("sequence > ?");
      parameters.push(this.assertSequence("afterSequence", anchor.afterSequence, 0));
    } else if ("beforeSequence" in anchor) {
      conditions.push("sequence < ?");
      parameters.push(this.assertSequence("beforeSequence", anchor.beforeSequence, 1));
      descending = true;
    } else {
      throw new ConversationEventQueryError("anchor is invalid");
    }

    if (query.direction !== undefined) {
      if (query.direction !== "input" && query.direction !== "output") {
        throw new ConversationEventQueryError("direction must be input or output");
      }
      conditions.push("event_direction = ?");
      parameters.push(query.direction);
    }
    if (query.eventTypes !== undefined) {
      if (query.eventTypes.length === 0) {
        conditions.push("0 = 1");
      } else {
        for (const eventType of query.eventTypes) {
          if (!isEventType(eventType)) {
            throw new ConversationEventQueryError(`Invalid event type filter: ${eventType}`);
          }
        }
        conditions.push(`event_type IN (${query.eventTypes.map(() => "?").join(", ")})`);
        parameters.push(...query.eventTypes);
      }
    }
    if (query.runId !== undefined) {
      this.assertIdentifier("runId", query.runId);
      conditions.push("run_id = ?");
      parameters.push(query.runId);
    }
    if (query.turnId !== undefined) {
      this.assertIdentifier("turnId", query.turnId);
      conditions.push("turn_id = ?");
      parameters.push(query.turnId);
    }

    return {
      whereSql: conditions.join(" AND "),
      parameters,
      descending,
      limit,
      highWatermark,
    };
  }

  private existsMatching(plan: QueryPlan, boundarySql: string, boundary: number): boolean {
    const row = this.database
      .prepare(
        `SELECT 1 AS found FROM journal_records
         WHERE ${this.baseFilterSql(plan)} AND ${boundarySql}
         LIMIT 1`,
      )
      .get(...this.baseFilterParameters(plan), boundary) as { found: number } | undefined;
    return row !== undefined;
  }

  private hasPreviousForEmptyPage(query: ConversationEventQuery, plan: QueryPlan): boolean {
    if ("afterSequence" in query.anchor) {
      return this.existsMatching(plan, "sequence <= ?", query.anchor.afterSequence);
    }
    return false;
  }

  private hasNextForEmptyPage(query: ConversationEventQuery, plan: QueryPlan): boolean {
    if ("beforeSequence" in query.anchor) {
      return this.existsMatching(plan, "sequence >= ?", query.anchor.beforeSequence);
    }
    return false;
  }

  private baseFilterSql(plan: QueryPlan): string {
    const anchorClauses = ["sequence > ?", "sequence < ?"];
    return plan.whereSql
      .split(" AND ")
      .filter((clause) => !anchorClauses.includes(clause))
      .join(" AND ");
  }

  private baseFilterParameters(plan: QueryPlan): SQLInputValue[] {
    const parameters = [...plan.parameters];
    const anchorParameterCount =
      plan.whereSql.includes("sequence > ?") || plan.whereSql.includes("sequence < ?") ? 1 : 0;
    if (anchorParameterCount === 1) parameters.splice(2, 1);
    return parameters;
  }

  private selectConversationSequence(conversationId: string): ConversationSequenceRow | undefined {
    return this.database
      .prepare("SELECT last_journal_sequence FROM conversations WHERE id = ?")
      .get(conversationId) as ConversationSequenceRow | undefined;
  }

  private requireConversationSequence(conversationId: string): ConversationSequenceRow {
    const row = this.selectConversationSequence(conversationId);
    if (row === undefined) throw new JournalConversationNotFoundError(conversationId);
    return row;
  }

  private selectExistingEvent(
    conversationId: string,
    eventId: string,
  ): JournalRecordRow | undefined {
    return this.database
      .prepare("SELECT * FROM journal_records WHERE conversation_id = ? AND event_id = ?")
      .get(conversationId, eventId) as JournalRecordRow | undefined;
  }

  private columnsMatch(row: JournalRecordRow, record: PreparedJournalRecord): boolean {
    return (
      row.conversation_id === record.conversationId &&
      row.event_id === record.eventId &&
      row.event_type === record.eventType &&
      row.schema_version === record.schemaVersion &&
      row.event_timestamp === record.eventTimestamp &&
      row.run_id === record.runId &&
      row.turn_id === record.turnId &&
      row.correlation_id === record.correlationId &&
      row.causation_id === record.causationId
    );
  }

  private insertJournalRecord(
    record: PreparedJournalRecord,
    sequence: number,
    recordedAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO journal_records(
           conversation_id,
           sequence,
           event_id,
           event_direction,
           event_type,
           schema_version,
           event_timestamp,
           recorded_at,
           run_id,
           turn_id,
           correlation_id,
           causation_id,
           event_json,
           event_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.conversationId,
        sequence,
        record.eventId,
        record.direction,
        record.eventType,
        record.schemaVersion,
        record.eventTimestamp,
        recordedAt,
        record.runId,
        record.turnId,
        record.correlationId,
        record.causationId,
        record.eventJson,
        record.eventHash,
      );
  }

  private assertIdentifier(label: string, value: string): void {
    if (value.trim().length === 0) {
      throw new ConversationEventQueryError(`${label} must not be empty`);
    }
  }

  private assertSequence(label: string, value: number, minimum: number): number {
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new ConversationEventQueryError(`${label} must be an integer greater than or equal to ${minimum}`);
    }
    return value;
  }
}
