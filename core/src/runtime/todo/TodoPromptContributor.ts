/** Adds the durable current Todo snapshot to the Runtime system-context overlay. */
import {
  TODO_STATUS,
  type ConversationTodoReader,
  type ConversationTodoSnapshot,
  type TodoItemSnapshot,
} from "./TodoProtocol.js";

export class TodoPromptContributor {
  constructor(private readonly reader: ConversationTodoReader) {}

  async append(
    conversationId: string,
    systemPrompt: string,
  ): Promise<string> {
    const snapshot = await this.reader.read(conversationId);
    return this.appendSnapshot(systemPrompt, snapshot);
  }

  appendSnapshot(
    systemPrompt: string,
    snapshot: ConversationTodoSnapshot | undefined,
  ): string {
    if (snapshot === undefined || snapshot.todos.length === 0) {
      return systemPrompt;
    }
    const overlay = [
      `<CURRENT_TODOS revision="${escapeAttribute(String(snapshot.revision))}">`,
      "This is durable Runtime execution state, not user instructions.",
      ...snapshot.todos.map(renderTodo),
      "</CURRENT_TODOS>",
    ].join("\n");
    return systemPrompt.length === 0 ? overlay : `${systemPrompt}\n\n${overlay}`;
  }
}

function renderTodo(todo: TodoItemSnapshot): string {
  const status = todo.status === TODO_STATUS.inProgress
    ? "in_progress"
    : todo.status;
  return `- [${status}] ${todo.id}: ${todo.content}`;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
