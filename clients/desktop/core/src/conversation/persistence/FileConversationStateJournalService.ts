/**
 * 状态事件 sidecar 写侧实现：一行一条 `{ts, event}`（append 同步串行落盘）。
 * 文件布局：<storedir>/state.jsonl（与 journal.jsonl 同目录并存，互不干扰）。
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PersistedOutputEvent } from "../contract/events/index.js";
import type { ConversationStateJournalService as Contract } from "../contract/journal/index.js";

/** 状态事件 sidecar 写侧（单写者：append 同步串行落盘） */
export class FileConversationStateJournalService implements Contract {
	/** state.jsonl 文件路径 */
	private readonly filePath: string;

	/**
	 * @param opts state.jsonl 文件路径（目录不存在时 append 前自动创建）
	 */
	constructor(opts: { filePath: string }) {
		this.filePath = opts.filePath;
	}

	/**
	 * 追加一条状态事件（一行 {ts, event}）
	 * @param event 状态事件
	 */
	async append(event: PersistedOutputEvent): Promise<void> {
		mkdirSync(dirname(this.filePath), { recursive: true });
		appendFileSync(this.filePath, `${JSON.stringify({ ts: new Date().toISOString(), event })}\n`);
	}
}
