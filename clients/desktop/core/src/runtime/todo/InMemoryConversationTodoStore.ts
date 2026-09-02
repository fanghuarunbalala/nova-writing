/**
 * 内存版会话 todo 存储（进程内 per-conversation）。
 */
import type { ConversationTodoSnapshot, ConversationTodoStore } from "./TodoProtocol.js";

/** 内存版 todo 存储 */
export class InMemoryConversationTodoStore implements ConversationTodoStore {
	/** conversationId → 快照 */
	private readonly states = new Map<string, ConversationTodoSnapshot>();

	/** 读会话 todo 快照 */
	async read(conversationId: string): Promise<ConversationTodoSnapshot | undefined> {
		return this.states.get(conversationId);
	}

	/** 保存会话 todo 快照 */
	async save(snapshot: ConversationTodoSnapshot): Promise<void> {
		this.states.set(snapshot.conversationId, snapshot);
	}
}
