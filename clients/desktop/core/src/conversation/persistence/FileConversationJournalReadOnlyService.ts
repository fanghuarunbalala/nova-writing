/**
 * journal 读侧实现：进程无关（纯文件读取，任何进程可访问 history），返回适配的 OutputEvent 序列（无 delta）。
 * 文件布局：<journalDir>/<conversationId>/journal.jsonl（与写侧 storedir 布局一致）。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RunContext } from "../../runtime/loop/types.js";
import type { LLMessage } from "../../runtime/provider/types.js";
import type { OutputEvent, PersistedOutputEvent, ProjectedEvent } from "../contract/events/index.js";
import type { ToolPreviewResolver } from "../../runtime/tool/previews.js";
import { resolveToolPreview } from "../../runtime/tool/previews.js";
import { ProjectionLayer } from "../projection/ProjectionLayer.js";
import type {
	ConversationJournalReadOnlyService as Contract,
	JournalHistoryOpts,
	PersistedRun,
} from "../contract/journal/index.js";

/** 状态事件类型名白名单（state.jsonl 只落 compose/mode 边界事件） */
const STATE_EVENT_TYPES: ReadonlySet<string> = new Set([
	"compose.begin",
	"compose.submitted",
	"compose.applied",
	"compose.discarded",
	"mode.changed",
]);

/** 缺省 preview 查询器：纯目录（Main 代读无 ToolDef 运行时实例，保证 live/replay 一致） */
const defaultResolver: ToolPreviewResolver = { resolvePreview: resolveToolPreview };

/** 折叠缓存条目（stat 失效判定：size+mtime 任一变化即重折叠） */
interface FoldCacheEntry {
	size: number;
	mtimeMs: number;
	runs: PersistedRun[];
}

/**
 * journal 折叠缓存（纯云端化 ⑤）：整读+折叠是 O(文件)，main 读侧按调用重建服务实例，
 * 缓存必须落模块级（绝对文件路径键控）。追加/重写都会改变 size/mtime → 失效重折；
 * 容量 8 条按插入序淘汰（Map 迭代序 = 插入序，重插移尾兼做 LRU）。镜像多写者并发下
 * 最坏读到旧一拍的数据，由投影层的 seq 去重门兜底（不会重复应用）。
 */
const FOLD_CACHE_LIMIT = 8;
const foldCache = new Map<string, FoldCacheEntry>();

function readCachedRuns(file: string): PersistedRun[] | undefined {
	const entry = foldCache.get(file);
	if (entry === undefined) return undefined;
	try {
		const st = statSync(file);
		if (st.size === entry.size && st.mtimeMs === entry.mtimeMs) return [...entry.runs];
	} catch {
		// 文件消失/不可访问：失效
	}
	foldCache.delete(file);
	return undefined;
}

function writeCachedRuns(file: string, runs: PersistedRun[]): void {
	try {
		const st = statSync(file);
		foldCache.delete(file);
		foldCache.set(file, { size: st.size, mtimeMs: st.mtimeMs, runs });
		if (foldCache.size > FOLD_CACHE_LIMIT) {
			const oldest = foldCache.keys().next().value;
			if (oldest !== undefined && oldest !== file) foldCache.delete(oldest);
		}
	} catch {
		// stat 失败不缓存（下次现读）
	}
}

/** journal 读侧实现（跨进程读 history + projectedHistory 投影读取 + state.jsonl 状态事件） */
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
	 * 读取会话已落盘 run，映射为 OutputEvent 序列（同 seq 取最新；不含 assistant.delta）。
	 * 分页语义（纯云端化 ⑤）：缺省/`fromSeq+limit` = 头部前向页（resume/补拉）；`latest` =
	 * 最近 limit 个 run（首屏）；`before` = seq < before 的最近 limit 个 run（向上翻页）。
	 * @param conversationId 会话 id
	 * @param opts 分页/游标
	 * @returns OutputEvent 序列
	 */
	async history(
		conversationId: string,
		opts: JournalHistoryOpts,
	): Promise<OutputEvent[]> {
		const runs = this.readLatestRuns(conversationId);
		let sorted = [...runs].sort((a, b) => a.seq - b.seq);
		if (opts.before !== undefined) {
			sorted = sorted.filter((r) => r.seq < opts.before!);
			if (opts.limit !== undefined) sorted = sorted.slice(Math.max(0, sorted.length - opts.limit));
		} else if (opts.latest === true) {
			if (opts.limit !== undefined) sorted = sorted.slice(Math.max(0, sorted.length - opts.limit));
		} else {
			if (opts.fromSeq !== undefined) sorted = sorted.filter((r) => r.seq >= opts.fromSeq!);
			if (opts.limit !== undefined) sorted = sorted.slice(0, opts.limit);
		}
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
		opts: JournalHistoryOpts,
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
	 * 读取会话已落盘 runs（按 run.seq 去重取最新、升序；子进程恢复上下文用）
	 * @param conversationId 会话 id
	 * @returns 已落盘 run 列表
	 */
	async readRuns(conversationId: string): Promise<PersistedRun[]> {
		return this.readLatestRuns(conversationId);
	}

	/**
	 * 读取会话状态事件（state.jsonl，落盘顺序；坏行/半行容忍跳过）
	 * @param conversationId 会话 id
	 * @returns 状态事件序列（compose/mode 边界事件）
	 */
	async readStateEvents(conversationId: string): Promise<PersistedOutputEvent[]> {
		const file = join(this.journalDir, conversationId, "state.jsonl");
		if (!existsSync(file)) return [];
		const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
		const events: PersistedOutputEvent[] = [];
		for (const line of lines) {
			try {
				const parsed = JSON.parse(line) as { event?: unknown };
				if (isStateEvent(parsed.event)) events.push(parsed.event);
			} catch {
				// 末尾半行/损坏行忽略（append-only 容忍）
			}
		}
		return events;
	}

	/**
	 * 读文件并按文件序折叠为每 seq 的最终 run（快照定基 + 增量顺序回放）。
	 * 行协议：`kind:"append"` 行把 messages 折叠到同 seq 基线上；snapshot 行（含无 kind 的
	 * 旧格式行）重置基线。孤儿增量（无快照基线）合成空基线，保证 run 边界事件完整。
	 * 折叠结果经模块级缓存复用（stat 失效；见 foldCache）。
	 */
	private readLatestRuns(conversationId: string): PersistedRun[] {
		const file = join(this.journalDir, conversationId, "journal.jsonl");
		if (!existsSync(file)) return [];
		const cached = readCachedRuns(file);
		if (cached !== undefined) return cached;
		const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
		// 末尾半行/损坏行容忍（append-only 多读者安全）；JSON 反序列化已剥离运行时闭包
		const bySeq = new Map<number, PersistedRun>();
		for (const line of lines) {
			try {
				const parsed = JSON.parse(line) as {
					seq?: number;
					kind?: "snapshot" | "append";
					run?: RunContext;
					messages?: LLMessage[];
					ts?: string;
				};
				if (parsed.seq === undefined) continue;
				if (parsed.kind === "append") {
					const base = bySeq.get(parsed.seq);
					if (base === undefined) {
						bySeq.set(parsed.seq, {
							seq: parsed.seq,
							messages: [...(parsed.messages ?? [])],
							ts: parsed.ts ?? new Date().toISOString(),
						});
					} else {
						base.messages.push(...(parsed.messages ?? []));
					}
				} else {
					// snapshot（新格式 kind:"snapshot"；旧格式无 kind）→ 重置该 seq 基线
					const run = parsed.run;
					if (run) bySeq.set(run.seq, run);
				}
				} catch {
					// 忽略损坏行
				}
		}
		const runs = [...bySeq.values()];
		writeCachedRuns(file, runs);
		return runs;
	}
}

/** 形状守卫：只放行 state.jsonl 白名单内的事件变体 */
function isStateEvent(value: unknown): value is PersistedOutputEvent {
	if (value === null || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.type === "string" &&
		STATE_EVENT_TYPES.has(record.type) &&
		record.persist === true &&
		typeof record.conversationId === "string"
	);
}

/** run 序列 → OutputEvent 序列（run-start/end 边界 + 消息/工具事件映射） */
function toOutputEvents(runs: PersistedRun[], conversationId: string): OutputEvent[] {
	const events: OutputEvent[] = [];
	for (const run of runs) {
		events.push({
			type: "run-start",
			persist: true,
			seq: run.seq,
			runSeq: run.seq,
			conversationId,
			ts: run.ts,
		});
		for (const m of run.messages) {
			if (m.role === "user") {
				events.push({
					type: "user.message",
					persist: true,
					seq: run.seq,
					text: m.content,
					conversationId,
					ts: run.ts,
				});
			} else if (m.role === "assistant") {
				events.push({
					type: "assistant.message",
					persist: true,
					seq: run.seq,
					text: m.content,
					conversationId,
					ts: run.ts,
				});
				for (const tc of m.toolCalls ?? []) {
					events.push({
						type: "tool-call-request",
						persist: true,
						seq: run.seq,
						toolCallId: tc.id,
						name: tc.name,
						args: tc.args,
						conversationId,
						ts: run.ts,
					});
				}
			} else if (m.role === "tool") {
				events.push({
					type: "tool-call-response",
					persist: true,
					seq: run.seq,
					toolCallId: m.id,
					result: m.content,
					conversationId,
					ts: run.ts,
				});
			}
		}
		events.push({
			type: "run-end",
			persist: true,
			seq: run.seq,
			runSeq: run.seq,
			conversationId,
			ts: run.ts,
		});
	}
	return events;
}
