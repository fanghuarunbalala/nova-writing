/**
 * journal 写侧实现：以 run 为单位落盘（每行一个完整 RunContext 快照，带 {seq, run}）。
 * seq 空间 = run seq（由 LoopContext 分配）：同 seq 可多写（assistant/tool 增量快照更新，读侧取最新）。
 * 不兼容旧格式（{seq, turn} 行）：读侧只认 run key，旧行按损坏行忽略（开发期决策，
 * 见 PRD `conversation-run-turn-术语统一` §4.4）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RunContext } from "../../runtime/loop/types.js";
import type { Receipt } from "../contract/types/index.js";
import type { ConversationJournalService as Contract } from "../contract/journal/index.js";

/** journal 写侧实现（单写者：append 同步串行落盘） */
export class FileConversationJournalService implements Contract {
	/** conversation id */
	private readonly conversationId: string;
	/** journal 文件路径（<storedir>/journal.jsonl） */
	private readonly filePath: string;
	/** 最近落盘的 run seq（open 时全行扫描恢复；appendRun 用 max 更新） */
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
	 * 追加一个 run 快照（一行 {seq, run}；同 seq 多写 = 快照更新，读侧取最新）
	 * @param run 当前 run（seq 由 LoopContext 分配）
	 * @returns 持久化回执（seq = run.seq）
	 */
	async appendRun(run: RunContext): Promise<Receipt> {
		this.lastPersistedSeq = Math.max(this.lastPersistedSeq, run.seq);
		appendFileSync(this.filePath, `${JSON.stringify({ seq: run.seq, run })}\n`);
		return { seq: run.seq, recordedAt: new Date().toISOString() };
	}

	/**
	 * 全量覆盖写（compaction 后去重的 runs）
	 * @param runs 压缩后的 run 序列
	 */
	async writeRuns(runs: RunContext[]): Promise<void> {
		this.lastPersistedSeq = runs.reduce((max, r) => Math.max(max, r.seq), 0);
		const lines = runs.map((r) => JSON.stringify({ seq: r.seq, run: r })).join("\n");
		writeFileSync(this.filePath, lines ? `${lines}\n` : "");
	}

	/** 强制落盘（appendFileSync 已同步写，无需额外 flush） */
	async flush(): Promise<void> {}

	/** 关闭 journal */
	async close(): Promise<void> {}

	/** 崩溃恢复：lastSeq 已在 open 恢复；读模型重建由上层 reconcile 接入 */
	async reconcile(): Promise<void> {}

	/** 最近落盘的 run seq（无落盘为 0；控制类回执用） */
	get lastSeq(): number {
		return this.lastPersistedSeq;
	}

	/** conversation id（读侧定位用） */
	get id(): string {
		return this.conversationId;
	}
}
