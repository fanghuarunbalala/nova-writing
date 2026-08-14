/**
 * journal 写侧实现：以 run 为单位落盘，增量行协议（gui-performance-2 功能点二）。
 * 行格式：`{seq, kind:"snapshot", run}`（run 开号一次）+ `{seq, kind:"append", messages}`（每次
 * 消息追加一行增量）——写盘成本 O(增量) 而非 O(run 全量)；旧格式 `{seq, run}`（无 kind）读侧按
 * snapshot 兼容解释。写入经串行异步队列（appendFile/writeFile，不阻塞事件循环），
 * flush 排空队列（退出/暂停路径显式调用）。
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunContext } from "../../runtime/loop/types.js";
import type { LLMessage } from "../../runtime/provider/types.js";
import type { Receipt } from "../contract/types/index.js";
import type { ConversationJournalService as Contract } from "../contract/journal/index.js";

/** journal 写侧实现（单写者：串行异步写队列保序落盘） */
export class FileConversationJournalService implements Contract {
	/** conversation id */
	private readonly conversationId: string;
	/** journal 文件路径（<storedir>/journal.jsonl） */
	private readonly filePath: string;
	/** 最近落盘的 run seq（open 时全行扫描恢复；appendRun 用 max 更新） */
	private lastPersistedSeq = 0;
	/** 串行写队列（调用序 = 落盘序；链吞错保持可用，错误抛给各调用方） */
	private writeChain: Promise<void> = Promise.resolve();

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
	 * 追加一个 run 快照行（run 开号一次；同 seq 多写 = 快照重置基线）
	 * @param run 当前 run（含 messages）
	 * @returns 持久化回执（seq = run.seq）
	 */
	async appendRun(run: RunContext): Promise<Receipt> {
		this.lastPersistedSeq = Math.max(this.lastPersistedSeq, run.seq);
		const line = `${JSON.stringify({ seq: run.seq, kind: "snapshot", run })}\n`;
		await this.enqueueWrite(() => appendFile(this.filePath, line, "utf8"));
		return { seq: run.seq, recordedAt: new Date().toISOString() };
	}

	/**
	 * 追加 run 消息增量行（只含本次追加的消息；读侧按文件序折叠到同 seq 基线）
	 * @param seq 所属 run seq
	 * @param messages 本次追加的消息（增量）
	 * @returns 持久化回执（seq）
	 */
	async appendRunMessages(seq: number, messages: LLMessage[]): Promise<Receipt> {
		this.lastPersistedSeq = Math.max(this.lastPersistedSeq, seq);
		const line = `${JSON.stringify({ seq, kind: "append", messages, ts: new Date().toISOString() })}\n`;
		await this.enqueueWrite(() => appendFile(this.filePath, line, "utf8"));
		return { seq, recordedAt: new Date().toISOString() };
	}

	/**
	 * 全量覆盖写（compaction/clear 后重写为 snapshot 行序列）
	 * @param runs 压缩后的 run 序列
	 */
	async writeRuns(runs: RunContext[]): Promise<void> {
		this.lastPersistedSeq = runs.reduce((max, r) => Math.max(max, r.seq), 0);
		const lines = runs.map((r) => JSON.stringify({ seq: r.seq, kind: "snapshot", run: r })).join("\n");
		const content = lines ? `${lines}\n` : "";
		await this.enqueueWrite(() => writeFile(this.filePath, content, "utf8"));
	}

	/** 强制落盘（排空写队列；队列上的错误已在各调用方收口，此处不再抛） */
	async flush(): Promise<void> {
		await this.writeChain;
	}

	/** 关闭 journal（排空写队列） */
	async close(): Promise<void> {
		await this.flush();
	}

	/** 崩溃恢复：lastSeq 已在 open 恢复；读模型重建由上层 reconcile 接入 */
	async reconcile(): Promise<void> {}

	/** 入队一次写操作（调用序 = 落盘序；返回的 promise 保留原始错误供调用方 catch） */
	private enqueueWrite(task: () => Promise<void>): Promise<void> {
		const next = this.writeChain.then(task, task);
		this.writeChain = next.catch(() => {
			// 链本身吞错：前序失败不阻塞后续写（失败已由调用方告警）
		});
		return next;
	}

	/** 最近落盘的 run seq */
	get lastSeq(): number {
		return this.lastPersistedSeq;
	}
}
