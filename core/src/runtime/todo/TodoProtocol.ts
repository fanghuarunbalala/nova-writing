/** Provider-neutral Runtime Todo state shared by the Todo Tool and projections. */

export const TODO_STATUS = {
  pending: "pending",
  inProgress: "in_progress",
  completed: "completed",
} as const;

export type TodoStatus = (typeof TODO_STATUS)[keyof typeof TODO_STATUS];

export const TODO_LIMITS = {
  maximumItems: 32,
  maximumContentLength: 2_000,
  maximumActiveFormLength: 2_000,
} as const;

export interface TodoItemSnapshot {
  readonly content: string;
  readonly status: TodoStatus;
  readonly activeForm: string;
}

export interface ConversationTodoSnapshot {
  readonly conversationId: string;
  readonly revision: number;
  readonly todos: readonly TodoItemSnapshot[];
  readonly updatedAt: string;
  /** 最后一次 TodoWrite 所在 runId（供跨 run 检测"多久未维护 todo"）。 */
  readonly lastUpdatedRunId?: string;
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
  readonly previousSnapshot?: ConversationTodoSnapshot;
  readonly eventSequence: number;
}

export interface ConversationTodoWriter {
  replace(
    request: ConversationTodoWriteRequest,
  ): Promise<ConversationTodoWriteResult>;
}
