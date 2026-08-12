/**
 * journal 读侧契约：UI / zygote 直连，跨会话查 history（只读）。
 */

import type { ConversationId } from "../types/index.js";
import type { PersistedOutputEvent } from "../events/index.js";

/** 读侧：跨会话查 history，只读 */
export interface ConversationJournalReadOnlyService {
	/**
	 * 读取会话已落盘事件
	 * @param conversationId 会话 id
	 * @param opts 分页/游标
	 * @returns 已落盘事件序列
	 */
	history(
		conversationId: ConversationId,
		opts: { fromSeq?: number; limit?: number }
	): Promise<PersistedOutputEvent[]>;
}
