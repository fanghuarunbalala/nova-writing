/** Provider-neutral Runtime Todo state shared by the Todo Tool and projections. */

export const TODO_STATUS = {
  pending: "pending",
  inProgress: "in_progress",
  completed: "completed",
  cancelled: "cancelled",
} as const;

export type TodoStatus = (typeof TODO_STATUS)[keyof typeof TODO_STATUS];

export const TODO_LIMITS = {
  maximumItems: 32,
  maximumIdLength: 128,
  maximumContentLength: 2_000,
} as const;

export interface TodoItemSnapshot {
  readonly id: string;
  readonly content: string;
  readonly status: TodoStatus;
}

export interface ConversationTodoSnapshot {
  readonly conversationId: string;
  readonly revision: number;
  readonly todos: readonly TodoItemSnapshot[];
  readonly updatedAt: string;
}

export interface ConversationTodoStore {
  read(conversationId: string): Promise<ConversationTodoSnapshot | undefined>;
  save(snapshot: ConversationTodoSnapshot): Promise<void>;
}

export interface ConversationTodoReader {
  read(conversationId: string): Promise<ConversationTodoSnapshot | undefined>;
}

export interface ConversationTodoWriteRequest {
  readonly conversationId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly turnId?: string;
  readonly todos: readonly TodoItemSnapshot[];
}

export interface ConversationTodoWriteResult {
  readonly snapshot: ConversationTodoSnapshot;
  readonly eventSequence: number;
}

export interface ConversationTodoWriter {
  replace(
    request: ConversationTodoWriteRequest,
  ): Promise<ConversationTodoWriteResult>;
}
