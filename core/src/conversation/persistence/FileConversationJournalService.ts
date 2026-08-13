/**
 * journal 写侧实现：以 turn 为单位落盘（每行一个完整 TurnContext 快照，带 {seq, turn}）。
 * seq 空间 = turn seq（由 LoopContext 分配）：同 seq 可多写（assistant/tool 增量快照更新，读侧取最新）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TurnContext } from "../../runtime/loop/types.js";
import type { Receipt } from "../contract/types/index.js";
import type { ConversationJournalService as Contract } from "../contract/journal/index.js";

/** journal 写侧实现（单写者：append 同步串行落盘） */
export class FileConversationJournalService implements Contract {
	/** conversation id */
	private readonly conversationId: string;
	/** journal 文件路径（<storedir>/journal.jsonl） */
	private readonly filePath: string;
	/** 最近落盘的 turn seq（open 时全行扫描恢复；appendTurn 用 max 更新） */
	private lastPersistedSeq = 0;

	/**
	 * @param opts conversationId + 文件路径
	 */
	constructor(opts: { conversationId: string; filePath: string }) {
		this.conversationId = opts.conversationId;
		this.filePath = opts.filePath;
	}

	/** 打开 journal：确保目录存在 + 全行扫描恢复 lastSeq（末尾半行/乱序行安全） */
	async open(): Promise<void> {
		mkdirSync(dirname(this.filePath), { recursive: true });
		if (existsSync(this.filePath)) {
			const lines = readFileSync(this.filePath, "utf8").split("\n").filter(Boolean);
			for (const line of lines) {
				try {
					const seq = (JSON.parse(line) as { seq?: number }).seq ?? 0;
					this.lastPersistedSeq = Math.max(this.lastPersistedSeq, seq);
				} catch {
					// 末尾半行/损坏行忽略（append-only 容忍）
				}
			}
		}
	}

	/**
	 * 追加一个 turn 快照（一行 {seq, turn}；同 seq 多写 = 快照更新，读侧取最新）
	 * @param turn 当前 turn（seq 由 LoopContext 分配）
	 * @returns 持久化回执（seq = turn.seq）
	 */
	async appendTurn(turn: TurnContext): Promise<Receipt> {
		this.lastPersistedSeq = Math.max(this.lastPersistedSeq, turn.seq);
		appendFileSync(this.filePath, `${JSON.stringify({ seq: turn.seq, turn })}\n`);
		return { seq: turn.seq, recordedAt: new Date().toISOString() };
	}

	/**
	 * 全量覆盖写（compaction 后去重的 turns）
	 * @param turns 压缩后的 turn 序列
	 */
	async writeTurns(turns: TurnContext[]): Promise<void> {
		this.lastPersistedSeq = turns.reduce((max, t) => Math.max(max, t.seq), 0);
		const lines = turns.map((t) => JSON.stringify({ seq: t.seq, turn: t })).join("\n");
		writeFileSync(this.filePath, lines ? `${lines}\n` : "");
	}

	/** 强制落盘（appendFileSync 已同步写，无需额外 flush） */
	async flush(): Promise<void> {}

	/** 关闭 journal */
	async close(): Promise<void> {}

	/** 崩溃恢复：lastSeq 已在 open 恢复；读模型重建由上层 reconcile 接入 */
	async reconcile(): Promise<void> {}

	/** 最近落盘的 turn seq（无落盘为 0；控制类回执用） */
	get lastSeq(): number {
		return this.lastPersistedSeq;
	}

	/** conversation id（读侧定位用） */
	get id(): string {
		return this.conversationId;
	}
}
