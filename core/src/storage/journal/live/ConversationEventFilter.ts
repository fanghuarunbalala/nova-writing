/**
 * Shared filtering protocol for historical Journal reads and live Event
 * subscriptions.
 *
 * @example
 * ```ts
 * const matcher = new ConversationEventFilterMatcher({
 *   direction: "output",
 *   eventTypes: ["agent.assistant"],
 * });
 * ```
 */
import { isEventType, type EventKind } from "../../../event/index.js";
import type { PersistedConversationEventSnapshot } from "../PersistedConversationEventSnapshot.js";
import { ConversationEventFilterError } from "./ConversationEventLiveErrors.js";

export interface ConversationEventFilter {
  direction?: EventKind;
  eventTypes?: readonly string[];
  runId?: string;
  turnId?: string;
}

export interface NormalizedConversationEventFilter {
  readonly direction?: EventKind;
  readonly eventTypes?: readonly string[];
  readonly runId?: string;
  readonly turnId?: string;
}

export class ConversationEventFilterMatcher {
  readonly filter: NormalizedConversationEventFilter;

  private readonly eventTypes?: ReadonlySet<string>;

  constructor(filter: ConversationEventFilter = {}) {
    this.filter = normalizeConversationEventFilter(filter);
    this.eventTypes =
      this.filter.eventTypes === undefined
        ? undefined
        : new Set(this.filter.eventTypes);
  }

  matches(event: PersistedConversationEventSnapshot): boolean {
    return (
      (this.filter.direction === undefined || event.direction === this.filter.direction) &&
      (this.eventTypes === undefined || this.eventTypes.has(event.eventType)) &&
      (this.filter.runId === undefined || event.runId === this.filter.runId) &&
      (this.filter.turnId === undefined || event.turnId === this.filter.turnId)
    );
  }
}

export function normalizeConversationEventFilter(
  filter: ConversationEventFilter = {},
): NormalizedConversationEventFilter {
  if (filter === null || typeof filter !== "object" || Array.isArray(filter)) {
    throw new ConversationEventFilterError("Conversation Event filter must be an object");
  }
  assertAllowedKeys(filter, ["direction", "eventTypes", "runId", "turnId"]);
  if (
    filter.direction !== undefined &&
    filter.direction !== "input" &&
    filter.direction !== "output"
  ) {
    throw new ConversationEventFilterError("direction must be input or output");
  }

  const eventTypes = normalizeEventTypes(filter.eventTypes);
  const runId = normalizeOptionalIdentifier("runId", filter.runId);
  const turnId = normalizeOptionalIdentifier("turnId", filter.turnId);
  return Object.freeze({
    ...(filter.direction !== undefined ? { direction: filter.direction } : {}),
    ...(eventTypes !== undefined ? { eventTypes } : {}),
    ...(runId !== undefined ? { runId } : {}),
    ...(turnId !== undefined ? { turnId } : {}),
  });
}

function assertAllowedKeys(
  value: object,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey !== undefined) {
    throw new ConversationEventFilterError(
      `Unknown Conversation Event filter field: ${unknownKey}`,
    );
  }
}

function normalizeEventTypes(
  eventTypes: readonly string[] | undefined,
): readonly string[] | undefined {
  if (eventTypes === undefined) return undefined;
  if (!Array.isArray(eventTypes)) {
    throw new ConversationEventFilterError("eventTypes must be an array");
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const eventType of eventTypes) {
    if (typeof eventType !== "string" || !isEventType(eventType)) {
      throw new ConversationEventFilterError(`Invalid Event Type: ${String(eventType)}`);
    }
    if (seen.has(eventType)) continue;
    seen.add(eventType);
    normalized.push(eventType);
  }
  return Object.freeze(normalized);
}

function normalizeOptionalIdentifier(
  label: "runId" | "turnId",
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConversationEventFilterError(`${label} must not be blank`);
  }
  return value;
}
