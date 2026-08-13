/**
 * journal 读侧契约：UI / zygote 直连，跨会话查 history（只读，进程无关）。
 */

import type { ConversationId } from "../types/index.js";
import type { OutputEvent } from "../events/index.js";
import type { TurnContext } from "../../../runtime/loop/types.js";

/** 已落盘 turn（TurnContext 去掉运行时闭包方法的持久化形态） */
export type PersistedTurn = Omit<TurnContext, "appendTurnMessages">;

/** 读侧：跨会话查 history（纯文件读取，任何进程可访问），返回适配的 OutputEvent 序列 */
export interface ConversationJournalReadOnlyService {
	/**
	 * 读取会话已落盘 turn（映射为 OutputEvent 序列；不含 assistant.delta）
	 * @param conversationId 会话 id
	 * @param opts 分页/游标
	 * @returns OutputEvent 序列（turn-start/end 边界 + user/assistant.message + tool-call 事件）
	 */
	history(
		conversationId: ConversationId,
		opts: { fromSeq?: number; limit?: number }
	): Promise<OutputEvent[]>;
	/**
	 * 读取会话已落盘 turns（按 turn.seq 去重取最新、升序；子进程恢复上下文用）
	 * @param conversationId 会话 id
	 * @returns 已落盘 turn 列表
	 */
	readTurns(conversationId: ConversationId): Promise<PersistedTurn[]>;
}
