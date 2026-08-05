/** Public async stream returned to CLI, TUI, GUI, and Web adapters. */
import type { PersistedConversationEventSnapshot } from "../PersistedConversationEventSnapshot.js";
import {
  normalizeConversationEventFilter,
  type ConversationEventFilter,
  type NormalizedConversationEventFilter,
} from "./ConversationEventFilter.js";
import { ConversationEventSubscriptionOptionsError } from "./ConversationEventLiveErrors.js";

export const DEFAULT_CONVERSATION_EVENT_SUBSCRIPTION_CAPACITY = 4_096;
export const MAX_CONVERSATION_EVENT_SUBSCRIPTION_CAPACITY = 4_096;

export type ConversationEventSubscriptionStart =
  | { from: "start" }
  | { from: "latest" }
  | { afterSequence: number };

export interface LiveConversationEventSubscriptionOptions {
  conversationId: string;
  filter?: ConversationEventFilter;
  capacity?: number;
  signal?: AbortSignal;
}

export interface ConversationEventSubscriptionOptions {
  conversationId: string;
  start: ConversationEventSubscriptionStart;
  filter?: ConversationEventFilter;
  liveBufferCapacity?: number;
  signal?: AbortSignal;
}

export interface NormalizedLiveConversationEventSubscriptionOptions {
  readonly conversationId: string;
  readonly filter: NormalizedConversationEventFilter;
  readonly capacity: number;
  readonly signal?: AbortSignal;
}

export interface NormalizedConversationEventSubscriptionOptions {
  readonly conversationId: string;
  readonly start: ConversationEventSubscriptionStart;
  readonly filter: NormalizedConversationEventFilter;
  readonly liveBufferCapacity: number;
  readonly signal?: AbortSignal;
}

export interface ConversationEventSubscription
  extends AsyncIterableIterator<PersistedConversationEventSnapshot> {
  readonly id: string;
  readonly conversationId: string;

  close(): Promise<void>;
}

export function normalizeLiveConversationEventSubscriptionOptions(
  options: LiveConversationEventSubscriptionOptions,
): NormalizedLiveConversationEventSubscriptionOptions {
  assertOptionsObject(options);
  assertAllowedOptionKeys(options, ["conversationId", "filter", "capacity", "signal"]);
  const signal = validateAbortSignal(options.signal);
  return Object.freeze({
    conversationId: validateConversationEventSubscriptionConversationId(
      options.conversationId,
    ),
    filter: normalizeConversationEventFilter(options.filter),
    capacity: validateConversationEventSubscriptionCapacity(options.capacity),
    ...(signal !== undefined ? { signal } : {}),
  });
}

export function normalizeConversationEventSubscriptionOptions(
  options: ConversationEventSubscriptionOptions,
): NormalizedConversationEventSubscriptionOptions {
  assertOptionsObject(options);
  assertAllowedOptionKeys(options, [
    "conversationId",
    "start",
    "filter",
    "liveBufferCapacity",
    "signal",
  ]);
  const signal = validateAbortSignal(options.signal);
  return Object.freeze({
    conversationId: validateConversationEventSubscriptionConversationId(
      options.conversationId,
    ),
    start: validateConversationEventSubscriptionStart(options.start),
    filter: normalizeConversationEventFilter(options.filter),
    liveBufferCapacity: validateConversationEventSubscriptionCapacity(
      options.liveBufferCapacity,
    ),
    ...(signal !== undefined ? { signal } : {}),
  });
}

export function validateConversationEventSubscriptionStart(
  start: ConversationEventSubscriptionStart,
): ConversationEventSubscriptionStart {
  if (start === null || typeof start !== "object" || Array.isArray(start)) {
    throw new ConversationEventSubscriptionOptionsError(
      "Conversation Event subscription start must be an object",
    );
  }
  if (Object.keys(start).length !== 1) {
    throw new ConversationEventSubscriptionOptionsError(
      "Conversation Event subscription start must contain exactly one cursor",
    );
  }
  if ("from" in start) {
    if (start.from !== "start" && start.from !== "latest") {
      throw new ConversationEventSubscriptionOptionsError(
        "Conversation Event subscription start.from must be start or latest",
      );
    }
    return Object.freeze({ from: start.from });
  }
  if ("afterSequence" in start) {
    return Object.freeze({
      afterSequence: validateConversationEventSequence(
        "afterSequence",
        start.afterSequence,
        0,
      ),
    });
  }
  throw new ConversationEventSubscriptionOptionsError(
    "Conversation Event subscription start is invalid",
  );
}

export function validateConversationEventSubscriptionCapacity(
  value: number | undefined,
): number {
  const capacity = value ?? DEFAULT_CONVERSATION_EVENT_SUBSCRIPTION_CAPACITY;
  if (
    !Number.isSafeInteger(capacity) ||
    capacity < 1 ||
    capacity > MAX_CONVERSATION_EVENT_SUBSCRIPTION_CAPACITY
  ) {
    throw new ConversationEventSubscriptionOptionsError(
      `Subscription capacity must be an integer between 1 and ${MAX_CONVERSATION_EVENT_SUBSCRIPTION_CAPACITY}`,
    );
  }
  return capacity;
}

export function validateConversationEventSubscriptionConversationId(
  conversationId: string,
): string {
  if (typeof conversationId !== "string" || conversationId.trim().length === 0) {
    throw new ConversationEventSubscriptionOptionsError(
      "Conversation Event subscription conversationId must not be blank",
    );
  }
  return conversationId;
}

export function validateConversationEventSequence(
  label: string,
  value: number,
  minimum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new ConversationEventSubscriptionOptionsError(
      `${label} must be a safe integer greater than or equal to ${minimum}`,
    );
  }
  return value;
}

function assertOptionsObject(value: unknown): asserts value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConversationEventSubscriptionOptionsError(
      "Conversation Event subscription options must be an object",
    );
  }
}

function assertAllowedOptionKeys(
  value: object,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey !== undefined) {
    throw new ConversationEventSubscriptionOptionsError(
      `Unknown Conversation Event subscription option: ${unknownKey}`,
    );
  }
}

function validateAbortSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  if (signal === undefined) return undefined;
  if (
    signal === null ||
    typeof signal !== "object" ||
    typeof signal.aborted !== "boolean" ||
    typeof signal.addEventListener !== "function" ||
    typeof signal.removeEventListener !== "function"
  ) {
    throw new ConversationEventSubscriptionOptionsError(
      "signal must implement AbortSignal",
    );
  }
  return signal;
}
