/** Durable complete Todo snapshot emitted after a Runtime Todo replacement. */
import type { JsonObject } from "../../protocol/JsonValue.js";
import { captureTodoItems } from "../../../runtime/todo/TodoProtocolValidator.js";
import type { TodoItemSnapshot } from "../../../runtime/todo/TodoProtocol.js";
import { OutputPayload } from "../OutputPayload.js";

export interface AgentTodoUpdatedPayloadOptions {
  readonly toolCallId: string;
  readonly revision: number;
  readonly todos: readonly TodoItemSnapshot[];
  readonly updatedAt: string;
}

export class AgentTodoUpdatedPayload extends OutputPayload {
  readonly toolCallId: string;
  readonly revision: number;
  readonly todos: readonly TodoItemSnapshot[];
  readonly updatedAt: string;

  constructor(options: AgentTodoUpdatedPayloadOptions) {
    super();
    this.toolCallId = requireNonBlank("Todo Tool Call ID", options.toolCallId);
    this.revision = requirePositiveInteger("Todo revision", options.revision);
    this.todos = captureTodoItems(options.todos);
    this.updatedAt = requireNonBlank("Todo update time", options.updatedAt);
  }

  toObject(): JsonObject {
    return {
      toolCallId: this.toolCallId,
      revision: this.revision,
      todos: this.todos.map((todo) => ({
        id: todo.id,
        content: todo.content,
        status: todo.status,
      })),
      updatedAt: this.updatedAt,
    };
  }
}

function requireNonBlank(label: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requirePositiveInteger(label: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as number;
}
