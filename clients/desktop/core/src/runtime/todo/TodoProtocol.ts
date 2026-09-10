/**
 * Provider 中立的 Runtime Todo 状态（TodoWrite 工具与投影共享）。
 * 会话级执行计划：pending / in_progress / completed + content / activeForm。
 */

/** todo 状态 */
export type TodoStatus = "pending" | "in_progress" | "completed";

/** todo 条目快照 */
export interface TodoItemSnapshot {
	/** 祈使句内容（做什么） */
	readonly content: string;
	/** 状态 */
	readonly status: TodoStatus;
	/** 进行时展示（正在做什么） */
	readonly activeForm: string;
}

/** 会话 todo 快照 */
export interface ConversationTodoSnapshot {
	/** 会话 id */
	readonly conversationId: string;
	/** 版本（乐观并发 / 检测变更） */
	readonly revision: number;
	/** todo 列表 */
	readonly todos: readonly TodoItemSnapshot[];
	/** 更新时间 */
	readonly updatedAt: string;
}

/** todo 存储（读 / 写） */
export interface ConversationTodoStore {
	/**
	 * 读会话 todo 快照
	 * @param conversationId 会话 id
	 * @returns 快照；无则 undefined
	 */
	read(conversationId: string): Promise<ConversationTodoSnapshot | undefined>;
	/**
	 * 保存会话 todo 快照
	 * @param snapshot 快照
	 */
	save(snapshot: ConversationTodoSnapshot): Promise<void>;
}
