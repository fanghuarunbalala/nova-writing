/**
 * journal 读侧实现：进程无关（纯文件读取，任何进程可访问 history），返回适配的 OutputEvent 序列（无 delta）。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TurnContext } from "../../runtime/loop/types.js";
import type { OutputEvent } from "../contract/events/index.js";
import type { ConversationJournalReadOnlyService as Contract } from "../contract/journal/index.js";

/** journal 读侧实现（跨进程读 history） */
export class FileConversationJournalReadOnlyService implements Contract {
	/** journal 目录（按 conversationId 定位 `<id>.jsonl`） */
	private readonly journalDir: string;

	/**
	 * @param opts journal 目录
	 */
	constructor(opts: { journalDir: string }) {
		this.journalDir = opts.journalDir;
	}

	/**
	 * 读取会话已落盘 turn，映射为 OutputEvent 序列（同 seq 取最新；不含 assistant.delta）
	 * @param conversationId 会话 id
	 * @param opts 分页/游标
	 * @returns OutputEvent 序列
	 */
	async history(
		conversationId: string,
		opts: { fromSeq?: number; limit?: number },
	): Promise<OutputEvent[]> {
		const file = join(this.journalDir, `${conversationId}.jsonl`);
		if (!existsSync(file)) return [];
		const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
		const turns = lines
			.map((l) => (JSON.parse(l) as { turn?: TurnContext }).turn)
			.filter((t): t is TurnContext => Boolean(t));
		// 同 seq 取最新（每次追加更新的快照）
		const latest = new Map<number, TurnContext>();
		for (const t of turns) latest.set(t.seq, t);
		let sorted = [...latest.values()].sort((a, b) => a.seq - b.seq);
		if (opts.fromSeq !== undefined) sorted = sorted.filter((t) => t.seq >= opts.fromSeq!);
		if (opts.limit !== undefined) sorted = sorted.slice(0, opts.limit);
		return toOutputEvents(sorted, conversationId);
	}
}

/** turn 序列 → OutputEvent 序列（turn-start/end 边界 + 消息/工具事件映射） */
function toOutputEvents(turns: TurnContext[], conversationId: string): OutputEvent[] {
	const events: OutputEvent[] = [];
	for (const turn of turns) {
		events.push({
			type: "turn-start",
			persist: true,
			seq: turn.seq,
			turnSeq: turn.seq,
			conversationId,
			ts: turn.ts,
		});
		for (const m of turn.messages) {
			if (m.role === "user") {
				events.push({
					type: "user.message",
					persist: true,
					seq: turn.seq,
					text: m.content,
					conversationId,
					ts: turn.ts,
				});
			} else if (m.role === "assistant") {
				events.push({
					type: "assistant.message",
					persist: true,
					seq: turn.seq,
					text: m.content,
					conversationId,
					ts: turn.ts,
				});
				for (const tc of m.toolCalls ?? []) {
					events.push({
						type: "tool-call-request",
						persist: true,
						seq: turn.seq,
						toolCallId: tc.id,
						name: tc.name,
						args: tc.args,
						conversationId,
						ts: turn.ts,
					});
				}
			} else if (m.role === "tool") {
				events.push({
					type: "tool-call-response",
					persist: true,
					seq: turn.seq,
					toolCallId: m.id,
					result: m.content,
					conversationId,
					ts: turn.ts,
				});
			}
		}
		events.push({
			type: "turn-end",
			persist: true,
			seq: turn.seq,
			turnSeq: turn.seq,
			conversationId,
			ts: turn.ts,
		});
	}
	return events;
}
