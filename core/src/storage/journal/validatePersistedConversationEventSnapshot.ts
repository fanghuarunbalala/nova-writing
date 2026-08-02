/** Shared validation for durable Conversation Event snapshots at client and projection boundaries. */
import { coreEventSchemaRegistry } from "../../event/index.js";
import type { PersistedConversationEventSnapshot } from "./PersistedConversationEventSnapshot.js";

export class PersistedConversationEventValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "PersistedConversationEventValidationError";
  }
}

export function validatePersistedConversationEventSnapshot(
  value: unknown,
  expectedConversationId?: string,
): PersistedConversationEventSnapshot {
  const record = assertRecord(value, "Persisted Conversation Event");
  const direction = record.direction;
  if (direction !== "input" && direction !== "output") {
    throw new PersistedConversationEventValidationError(
      "Persisted Conversation Event direction is invalid",
    );
  }
  const sequence = assertSafeInteger(record.sequence, "Event sequence", 1);
  const recordedAt = assertNonEmptyString(record.recordedAt, "Event recordedAt");
  const { direction: _direction, sequence: _sequence, recordedAt: _recordedAt, ...snapshot } =
    record;
  const validated =
    direction === "input"
      ? coreEventSchemaRegistry.validateInput(snapshot, {
          allowUnknownEventType: true,
        })
      : coreEventSchemaRegistry.validateOutput(snapshot, {
          allowUnknownEventType: true,
        });
  if (
    expectedConversationId !== undefined &&
    validated.conversationId !== expectedConversationId
  ) {
    throw new PersistedConversationEventValidationError(
      "Persisted Conversation Event targets another Conversation",
    );
  }
  return Object.freeze({
    ...validated,
    direction,
    sequence,
    recordedAt,
  }) as PersistedConversationEventSnapshot;
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PersistedConversationEventValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PersistedConversationEventValidationError(
      `${label} must be a non-empty string`,
    );
  }
  return value;
}

function assertSafeInteger(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new PersistedConversationEventValidationError(
      `${label} must be a safe integer greater than or equal to ${minimum}`,
    );
  }
  return value as number;
}
