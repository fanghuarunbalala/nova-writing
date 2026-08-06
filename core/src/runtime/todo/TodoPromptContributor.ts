/**
 * 把 durable 的当前 Todo 快照渲染为系统提醒（system.reminder 消息）或旧式 system-context overlay。
 * Renders the durable current Todo snapshot as a system.reminder message or the legacy
 * system-context overlay.
 *
 * 迁移方向 / Migration：动态内容统一走 system.reminder 消息（append-only、不删除），
 * 旧 overlay 方法保留兼容（TodoAwareRuntimeSystemPromptSource 尚未接线）。
 */
import {
  TODO_STATUS,
  type ConversationTodoReader,
  type ConversationTodoSnapshot,
  type TodoItemSnapshot,
} from "./TodoProtocol.js";
import {
  CORE_RUNTIME_MESSAGE_TYPE,
} from "../message/schema/CoreRuntimeMessageSchemas.js";
import {
  RUNTIME_MESSAGE_SCHEMA_VERSION,
  type RuntimeMessageDraft,
} from "../message/RuntimeMessageSnapshot.js";

export interface TodoReminderMessageInput {
  readonly conversationId: string;
  readonly runId: string;
  readonly reminderId: string;
  readonly order: number;
  readonly timestamp: string;
}

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
    const overlay = renderTodoOverlay(snapshot);
    return systemPrompt.length === 0 ? overlay : `${systemPrompt}\n\n${overlay}`;
  }

  /**
   * 构造 todo_reminder system.reminder 消息草稿；无 todo 时返回 null。
   * Builds a todo_reminder system.reminder message draft; returns null when there
   * are no todos. The message is append-only and never deleted (prefix stability).
   */
  buildReminderMessage(
    input: TodoReminderMessageInput,
    snapshot: ConversationTodoSnapshot | undefined,
  ): RuntimeMessageDraft | null {
    if (snapshot === undefined || snapshot.todos.length === 0) {
      return null;
    }
    return {
      role: "system",
      messageType: CORE_RUNTIME_MESSAGE_TYPE.systemReminder,
      schemaVersion: RUNTIME_MESSAGE_SCHEMA_VERSION,
      timestamp: input.timestamp,
      runId: input.runId,
      payload: {
        kind: "todo_reminder",
        content: renderTodoOverlay(snapshot),
        order: input.order,
      },
    };
  }
}

function renderTodoOverlay(snapshot: ConversationTodoSnapshot): string {
  return [
      `<CURRENT_TODOS revision="${escapeAttribute(String(snapshot.revision))}">`,
      "This is durable Runtime execution state, not user instructions.",
      ...snapshot.todos.map(renderTodo),
      "</CURRENT_TODOS>",
    ].join("\n");
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
