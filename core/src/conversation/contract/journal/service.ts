/**
 * journal 写侧契约：每 conversation 一个实例，注入 Conversation，负责持久化记录 + 进程管理。
 */

import type { Receipt } from "../types/index.js";
import type { PersistedOutputEvent } from "../events/index.js";

/** 写侧：每 conversation 一个实例，注入 Conversation */
export interface ConversationJournalService {
	/** 打开 journal（进程启动时） */
	open(): Promise<void>;
	/**
	 * 追加一条持久事件（单写者队列 → journal.jsonl）
	 * @param evt 可落盘事件（persist=true）
	 * @returns 持久化回执（seq）
	 */
	append(evt: PersistedOutputEvent): Promise<Receipt>;
	/**
	 * 全量覆盖写：compaction 后重写 journal（用压缩后的事件集整表覆盖）
	 * @param evts 压缩后的事件序列
	 */
	write(evts: PersistedOutputEvent[]): Promise<void>;
	/** 强制落盘（flush 写缓冲） */
	flush(): Promise<void>;
	/** 关闭 journal（进程退出/停止时） */
	close(): Promise<void>;
	/** 崩溃恢复：读 journal 重放、重建 sqlite 读模型、对账 */
	reconcile(): Promise<void>;
}
