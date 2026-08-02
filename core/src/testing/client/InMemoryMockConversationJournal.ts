/** Deterministic testing-only Journal with production-compatible query semantics. */
import {
  canonicalStringifyJson,
  coreEventSchemaRegistry,
  type InputEventSnapshot,
  type JsonValue,
  type OutputEventSnapshot,
} from "../../event/index.js";
import type {
  ConversationEventPage,
  ConversationEventQuery,
  ConversationJournalStore,
  ConversationStatus,
  JournalAppendReceipt,
  JournalAppendRequest,
  PersistedConversationEventSnapshot,
} from "../../storage/index.js";
import {
  ConversationEventFilterMatcher,
  ConversationEventQueryError,
  JournalConversationNotAcceptingInputError,
  JournalConversationNotFoundError,
  JournalEventConflictError,
} from "../../storage/index.js";
import type { MockNovelHostClock } from "./DeterministicMockClock.js";

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 1_000;

interface MockConversationJournalState {
  status: ConversationStatus;
  events: PersistedConversationEventSnapshot[];
  eventCanonicalById: Map<string, string>;
}

export interface InMemoryMockConversationJournalOptions {
  readonly clock: MockNovelHostClock;
}

export class InMemoryMockConversationJournal
  implements ConversationJournalStore
{
  private readonly clock: MockNovelHostClock;
  private readonly conversations = new Map<string, MockConversationJournalState>();

  constructor(options: InMemoryMockConversationJournalOptions) {
    this.clock = options.clock;
  }

  registerConversation(conversationId: string, status: ConversationStatus): void {
    assertIdentifier("conversationId", conversationId);
    if (this.conversations.has(conversationId)) {
      throw new TypeError("Mock Journal Conversation is already registered");
    }
    this.conversations.set(conversationId, {
      status,
      events: [],
      eventCanonicalById: new Map(),
    });
  }

  setConversationStatus(conversationId: string, status: ConversationStatus): void {
    this.requireConversation(conversationId).status = status;
  }

  async append(request: JournalAppendRequest): Promise<JournalAppendReceipt> {
    const state = this.requireConversation(request.snapshot.conversationId);
    const snapshot = validateAndCloneSnapshot(request);
    const canonical = canonicalStringifyJson({
      direction: request.direction,
      snapshot,
    } as unknown as JsonValue);
    const existingCanonical = state.eventCanonicalById.get(snapshot.id);
    if (existingCanonical !== undefined) {
      const existing = state.events.find((event) => event.id === snapshot.id);
      if (existing === undefined || existingCanonical !== canonical) {
        throw new JournalEventConflictError(
          snapshot.conversationId,
          snapshot.id,
          existing?.direction ?? request.direction,
          request.direction,
        );
      }
      return Object.freeze({
        status: "duplicate",
        conversationId: snapshot.conversationId,
        eventId: snapshot.id,
        direction: request.direction,
        sequence: existing.sequence,
        recordedAt: existing.recordedAt,
      });
    }

    if (request.direction === "input" && state.status !== "active") {
      throw new JournalConversationNotAcceptingInputError(
        snapshot.conversationId,
        state.status,
      );
    }

    const sequence = state.events.length + 1;
    const recordedAt = this.clock.now();
    const event = Object.freeze({
      ...snapshot,
      direction: request.direction,
      sequence,
      recordedAt,
    }) as PersistedConversationEventSnapshot;
    state.events.push(event);
    state.eventCanonicalById.set(snapshot.id, canonical);
    return Object.freeze({
      status: "appended",
      conversationId: snapshot.conversationId,
      eventId: snapshot.id,
      direction: request.direction,
      sequence,
      recordedAt,
    });
  }

  async getHighWatermark(conversationId: string): Promise<number> {
    return this.requireConversation(conversationId).events.length;
  }

  async getBySequence(
    conversationId: string,
    sequence: number,
  ): Promise<PersistedConversationEventSnapshot | undefined> {
    assertSequence("sequence", sequence, 1);
    return this.requireConversation(conversationId).events[sequence - 1];
  }

  async getByEventId(
    conversationId: string,
    eventId: string,
  ): Promise<PersistedConversationEventSnapshot | undefined> {
    assertIdentifier("eventId", eventId);
    return this.requireConversation(conversationId).events.find(
      (event) => event.id === eventId,
    );
  }

  async list(query: ConversationEventQuery): Promise<ConversationEventPage> {
    const state = this.requireConversation(query.conversationId);
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
      throw new ConversationEventQueryError(
        `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`,
      );
    }
    const currentHighWatermark = state.events.length;
    const requestedWatermark =
      query.throughSequence === undefined
        ? currentHighWatermark
        : assertSequence("throughSequence", query.throughSequence, 0);
    const highWatermark = Math.min(currentHighWatermark, requestedWatermark);
    const matcher = new ConversationEventFilterMatcher({
      ...(query.direction !== undefined ? { direction: query.direction } : {}),
      ...(query.eventTypes !== undefined ? { eventTypes: query.eventTypes } : {}),
      ...(query.runId !== undefined ? { runId: query.runId } : {}),
      ...(query.turnId !== undefined ? { turnId: query.turnId } : {}),
    });
    const filtered = state.events.filter(
      (event) => event.sequence <= highWatermark && matcher.matches(event),
    );
    const anchor = validateAnchor(query.anchor);
    const eligible = filtered.filter((event) => matchesAnchor(event.sequence, anchor));
    const selected = selectPage(eligible, anchor, limit);
    const first = selected[0];
    const last = selected.at(-1);

    return Object.freeze({
      events: Object.freeze([...selected]) as unknown as ConversationEventPage["events"],
      highWatermark,
      hasPrevious:
        first === undefined
          ? emptyPageHasPrevious(filtered, anchor)
          : filtered.findIndex((event) => event.sequence === first.sequence) > 0,
      hasNext:
        last === undefined
          ? emptyPageHasNext(filtered, anchor)
          : filtered.findIndex((event) => event.sequence === last.sequence) <
            filtered.length - 1,
    });
  }

  private requireConversation(conversationId: string): MockConversationJournalState {
    assertIdentifier("conversationId", conversationId);
    const state = this.conversations.get(conversationId);
    if (state === undefined) {
      throw new JournalConversationNotFoundError(conversationId);
    }
    return state;
  }
}

function validateAndCloneSnapshot(
  request: JournalAppendRequest,
): InputEventSnapshot | OutputEventSnapshot {
  const serialized = JSON.parse(JSON.stringify(request.snapshot)) as unknown;
  return request.direction === "input"
    ? coreEventSchemaRegistry.validateInput(serialized, {
        allowUnknownEventType: true,
      })
    : coreEventSchemaRegistry.validateOutput(serialized, {
        allowUnknownEventType: true,
      });
}

function validateAnchor(
  anchor: ConversationEventQuery["anchor"],
): ConversationEventQuery["anchor"] {
  if (anchor === null || typeof anchor !== "object" || Array.isArray(anchor)) {
    throw new ConversationEventQueryError("anchor is required");
  }
  if (Object.keys(anchor).length !== 1) {
    throw new ConversationEventQueryError("anchor must contain exactly one cursor");
  }
  if ("from" in anchor) {
    if (anchor.from !== "start" && anchor.from !== "end") {
      throw new ConversationEventQueryError("anchor.from must be start or end");
    }
    return anchor;
  }
  if ("afterSequence" in anchor) {
    assertSequence("afterSequence", anchor.afterSequence, 0);
    return anchor;
  }
  if ("beforeSequence" in anchor) {
    assertSequence("beforeSequence", anchor.beforeSequence, 1);
    return anchor;
  }
  throw new ConversationEventQueryError("anchor is invalid");
}

function matchesAnchor(
  sequence: number,
  anchor: ConversationEventQuery["anchor"],
): boolean {
  if ("afterSequence" in anchor) return sequence > anchor.afterSequence;
  if ("beforeSequence" in anchor) return sequence < anchor.beforeSequence;
  return true;
}

function selectPage(
  events: readonly PersistedConversationEventSnapshot[],
  anchor: ConversationEventQuery["anchor"],
  limit: number,
): PersistedConversationEventSnapshot[] {
  if (("from" in anchor && anchor.from === "end") || "beforeSequence" in anchor) {
    return events.slice(-limit);
  }
  return events.slice(0, limit);
}

function emptyPageHasPrevious(
  events: readonly PersistedConversationEventSnapshot[],
  anchor: ConversationEventQuery["anchor"],
): boolean {
  return "afterSequence" in anchor
    ? events.some((event) => event.sequence <= anchor.afterSequence)
    : false;
}

function emptyPageHasNext(
  events: readonly PersistedConversationEventSnapshot[],
  anchor: ConversationEventQuery["anchor"],
): boolean {
  return "beforeSequence" in anchor
    ? events.some((event) => event.sequence >= anchor.beforeSequence)
    : false;
}

function assertIdentifier(label: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConversationEventQueryError(`${label} must not be empty`);
  }
}

function assertSequence(label: string, value: number, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new ConversationEventQueryError(
      `${label} must be an integer greater than or equal to ${minimum}`,
    );
  }
  return value;
}
