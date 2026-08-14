/**
 * journal 读侧实现：进程无关（纯文件读取，任何进程可访问 history），返回适配的 OutputEvent 序列（无 delta）。
 * 文件布局：<journalDir>/<conversationId>/journal.jsonl（与写侧 storedir 布局一致）。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TurnContext } from "../../runtime/loop/types.js";
import type { OutputEvent, ProjectedEvent } from "../contract/events/index.js";
import type { ToolPreviewResolver } from "../../runtime/tool/previews.js";
import { resolveToolPreview } from "../../runtime/tool/previews.js";
import { ProjectionLayer } from "../projection/ProjectionLayer.js";
import type {
	ConversationJournalReadOnlyService as Contract,
	PersistedTurn,
} from "../contract/journal/index.js";

/** 缺省 preview 查询器：纯目录（Main 代读无 ToolDef 运行时实例，保证 live/replay 一致） */
const defaultResolver: ToolPreviewResolver = { resolvePreview: resolveToolPreview };

/** journal 读侧实现（跨进程读 history + projectedHistory 投影读取） */
export class FileConversationJournalReadOnlyService implements Contract {
	/** journal 根目录（按 `<dir>/<conversationId>/journal.jsonl` 定位） */
	private readonly journalDir: string;
	/** 投影层（projectedHistory 用；与 live 流同一实现） */
	private readonly projection: ProjectionLayer;

	/**
	 * @param opts journal 根目录 + 可选 preview 查询器（缺省纯目录 resolveToolPreview）
	 */
	constructor(opts: { journalDir: string; resolvePreview?: ToolPreviewResolver }) {
		this.journalDir = opts.journalDir;
		this.projection = new ProjectionLayer({ resolvePreview: opts.resolvePreview ?? defaultResolver });
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
		const turns = this.readLatestTurns(conversationId);
		let sorted = turns.sort((a, b) => a.seq - b.seq);
		if (opts.fromSeq !== undefined) sorted = sorted.filter((t) => t.seq >= opts.fromSeq!);
		if (opts.limit !== undefined) sorted = sorted.slice(0, opts.limit);
		return toOutputEvents(sorted, conversationId);
	}

	/**
	 * 投影读取：history 完整事件 → 过 ProjectionLayer → ProjectedEvent 流（与 hub 实时订阅同形态）
	 * @param conversationId 会话 id
	 * @param opts 分页/游标（与 history 相同语义）
	 * @returns ProjectedEvent 序列（工具调用为 tool-recorded 对；无完整 tool-call）
	 */
	async projectedHistory(
		conversationId: string,
		opts: { fromSeq?: number; limit?: number },
	): Promise<ProjectedEvent[]> {
		const complete = await this.history(conversationId, opts);
		const projected: ProjectedEvent[] = [];
		for (const event of complete) {
			const out = this.projection.project(event);
			if (out !== undefined) projected.push(out);
		}
		return projected;
	}

	/**
	 * 读取会话已落盘 turns（按 turn.seq 去重取最新、升序）
	 * @param conversationId 会话 id
	 * @returns 已落盘 turn 列表（恢复上下文用）
	 */
	async readTurns(conversationId: string): Promise<PersistedTurn[]> {
		return this.readLatestTurns(conversationId);
	}

	/** 读文件并按 turn.seq 去重取最新（同步：文件小、单次解析） */
	private readLatestTurns(conversationId: string): PersistedTurn[] {
		const file = join(this.journalDir, conversationId, "journal.jsonl");
		if (!existsSync(file)) return [];
		const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
		// 末尾半行/损坏行容忍（append-only 多读者安全）；JSON 反序列化已剥离运行时闭包
		const latest = new Map<number, PersistedTurn>();
		for (const line of lines) {
			try {
				const parsed = JSON.parse(line) as { seq?: number; turn?: TurnContext };
				const turn = parsed.turn;
				if (parsed.seq !== undefined && turn) {
					latest.set(turn.seq, turn);
				}
			} catch {
				// 忽略损坏行
			}
		}
		return [...latest.values()];
	}
}

/** turn 序列 → OutputEvent 序列（turn-start/end 边界 + 消息/工具事件映射） */
function toOutputEvents(turns: PersistedTurn[], conversationId: string): OutputEvent[] {
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
