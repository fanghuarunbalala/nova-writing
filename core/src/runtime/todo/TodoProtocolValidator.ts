/** Validates and defensively captures Runtime Todo snapshots at async boundaries. */
import {
  TODO_LIMITS,
  TODO_STATUS,
  type ConversationTodoSnapshot,
  type TodoItemSnapshot,
  type TodoStatus,
} from "./TodoProtocol.js";

export function captureTodoItems(value: unknown): readonly TodoItemSnapshot[] {
  if (!Array.isArray(value) || value.length > TODO_LIMITS.maximumItems) {
    throw new TypeError("Todo items are invalid");
  }

  let inProgressCount = 0;
  const captured = value.map((item) => {
    if (!isRecord(item)) throw new TypeError("Todo item is invalid");
    const content = captureContent(item.content);
    const status = captureStatus(item.status);
    const activeForm = captureActiveForm(item.activeForm);
    if (status === TODO_STATUS.inProgress) inProgressCount += 1;
    return Object.freeze({ content, status, activeForm });
  });

  if (inProgressCount > 1) {
    throw new TypeError("A Conversation may have only one in-progress Todo");
  }
  return Object.freeze(captured);
}

export function captureConversationTodoSnapshot(
  value: unknown,
): ConversationTodoSnapshot {
  if (!isRecord(value)) throw new TypeError("Todo snapshot is invalid");
  const conversationId = captureIdentity(value.conversationId, "Conversation ID");
  const revision = captureRevision(value.revision);
  const updatedAt = captureIdentity(value.updatedAt, "Todo update time");
  const lastUpdatedRunId = captureOptionalIdentity(value.lastUpdatedRunId);
  return Object.freeze({
    conversationId,
    revision,
    todos: captureTodoItems(value.todos),
    updatedAt,
    ...(lastUpdatedRunId === undefined ? {} : { lastUpdatedRunId }),
  });
}

function captureContent(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > TODO_LIMITS.maximumContentLength
  ) {
    throw new TypeError("Todo content is invalid");
  }
  return value;
}

function captureActiveForm(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > TODO_LIMITS.maximumActiveFormLength
  ) {
    throw new TypeError("Todo activeForm is invalid");
  }
  return value;
}

function captureStatus(value: unknown): TodoStatus {
  if (
    value !== TODO_STATUS.pending &&
    value !== TODO_STATUS.inProgress &&
    value !== TODO_STATUS.completed
  ) {
    throw new TypeError("Todo status is invalid");
  }
  return value;
}

function captureRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError("Todo revision is invalid");
  }
  return value as number;
}

function captureIdentity(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function captureOptionalIdentity(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return captureIdentity(value, "Todo last update run ID");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
