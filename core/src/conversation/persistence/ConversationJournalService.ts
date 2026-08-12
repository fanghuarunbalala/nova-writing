/**
 * journal 写侧实现：以 turn 为单位落盘（每行一个完整 TurnContext），同 seq 可多写（快照更新，读侧取最新）。
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import type { TurnContext } from "../../runtime/loop/types.js";
import type { Receipt } from "../contract/types/index.js";
import type { ConversationJournalService as Contract } from "../contract/journal/index.js";

/** journal 写侧实现（单写者：append 同步串行落盘） */
export class ConversationJournalService implements Contract {
	/** conversation id */
	private readonly conversationId: string;
	/** journal 文件路径（<journalDir>/<conversationId>.jsonl） */
	private readonly filePath: string;
	/** 递增 seq（open 时从文件尾恢复） */
	private seq = 0;

	/**
	 * @param opts conversationId + 文件路径
	 */
	constructor(opts: { conversationId: string; filePath: string }) {
		this.conversationId = opts.conversationId;
		this.filePath = opts.filePath;
	}

	/** 打开 journal：从文件尾恢复 seq（崩溃/重启后继续递增） */
	async open(): Promise<void> {
		if (existsSync(this.filePath)) {
			const lines = readFileSync(this.filePath, "utf8").split("\n").filter(Boolean);
			const last = lines.at(-1);
			if (last) {
				try {
					this.seq = (JSON.parse(last) as { seq?: number }).seq ?? 0;
				} catch {
					this.seq = 0;
				}
			}
		}
	}

	/**
	 * 追加一个 turn 快照（一行一个完整 TurnContext）
	 * @param turn 当前 turn
	 * @returns 持久化回执（seq）
	 */
	async appendTurn(turn: TurnContext): Promise<Receipt> {
		const seq = ++this.seq;
		appendFileSync(this.filePath, `${JSON.stringify({ seq, turn })}\n`);
		return { seq, recordedAt: new Date().toISOString() };
	}

	/**
	 * 全量覆盖写（compaction 后去重的 turns）
	 * @param turns 压缩后的 turn 序列
	 */
	async writeTurns(turns: TurnContext[]): Promise<void> {
		const lines = turns.map((t) => JSON.stringify({ seq: t.seq, turn: t })).join("\n");
		writeFileSync(this.filePath, lines ? `${lines}\n` : "");
	}

	/** 强制落盘（appendFileSync 已同步写，无需额外 flush） */
	async flush(): Promise<void> {}

	/** 关闭 journal */
	async close(): Promise<void> {}

	/** 崩溃恢复：seq 已在 open 恢复；读模型重建由上层 reconcile 接入 */
	async reconcile(): Promise<void> {}

	/** conversation id（读侧定位用） */
	get id(): string {
		return this.conversationId;
	}
}
