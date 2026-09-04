/**
 * journal 本地镜像原语（纯云端化 FR2）：server 权威账本的只读性能副本。
 * - 行协议与 File 版 journal.jsonl 同构（读侧 FileConversationJournalReadOnlyService 零改动），
 *   行内嵌 gs = server 账本全局行号——既做增量游标（replay?since=gs），也支撑并发写者
 *   （多子进程 / main 预播种 / postEvent 写通）按 gs 去重；
 * - 追加前重扫文件尾序、丢弃 gs ≤ 尾的行——根治「尾扫描 → fetch → 追加」窗口与
 *   写通路径竞态导致的重复行（重复的 append 行会在读侧折叠成重复消息）；
 * - 所有写失败静默：镜像是派生缓存，server 权威不受影响，坏档由收缩重建/全量重放自愈。
 */
import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** 镜像行（snapshot 行带 run / append 行带 messages；gs 为读侧忽略的附加字段） */
export interface MirrorRow {
	/** run seq（与 File 版行协议一致） */
	seq: number;
	kind: "snapshot" | "append";
	run?: unknown;
	messages?: unknown[];
	ts: string;
	/** server 账本全局 seq */
	gs: number;
}

/** server replay 响应行（账本原行；payload 为 JSON 字符串） */
export interface ReplayRow {
	seq?: number;
	run_seq?: number;
	kind?: string;
	payload?: string;
}

/** 可注入 fetch（测试；与 HttpConversationJournalService 同形） */
export type MirrorFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** 扫描镜像尾：最后一条完好行的 gs / run seq（末尾半行/损坏行向前容忍；无镜像 = 0） */
export async function readMirrorTail(path: string): Promise<{ gs: number; runSeq: number }> {
	try {
		if (!existsSync(path)) return { gs: 0, runSeq: 0 };
		const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
		for (let i = lines.length - 1; i >= 0; i -= 1) {
			try {
				const parsed = JSON.parse(lines[i]!) as { gs?: number; seq?: number };
				if (typeof parsed.gs === "number" && typeof parsed.seq === "number") {
					return { gs: parsed.gs, runSeq: parsed.seq };
				}
			} catch {
				// 末尾半行/损坏行：继续向前找完好行
			}
		}
	} catch {
		// 读失败按无镜像处理（下次成功写路径自然重建）
	}
	return { gs: 0, runSeq: 0 };
}

/** 待推事件 + server 全局 seq → 镜像行（与 Http 服务 PendingEvent 同形） */
export function mirrorRowOf(event: { runSeq: number; kind: "snapshot" | "append"; messages: unknown[] }, gs: number): MirrorRow {
	const ts = new Date().toISOString();
	return event.kind === "snapshot"
		? { seq: event.runSeq, kind: "snapshot", run: event.messages[0], ts, gs }
		: { seq: event.runSeq, kind: "append", messages: event.messages, ts, gs };
}

/** server 账本行 → 镜像行（memory-write/domain-mutation 等非消息行不入镜像） */
export function toMirrorRows(events: ReplayRow[]): MirrorRow[] {
	const rows: MirrorRow[] = [];
	for (const e of events) {
		if (e.kind !== "snapshot" && e.kind !== "append") continue;
		let payload: unknown[];
		try {
			payload = JSON.parse(e.payload ?? "[]") as unknown[];
		} catch {
			continue;
		}
		rows.push(
			e.kind === "snapshot"
				? { seq: e.run_seq ?? 0, kind: "snapshot", run: payload[0], ts: new Date().toISOString(), gs: e.seq ?? 0 }
				: { seq: e.run_seq ?? 0, kind: "append", messages: payload, ts: new Date().toISOString(), gs: e.seq ?? 0 },
		);
	}
	return rows;
}

/**
 * 追加镜像行（幂等去重）：追加前重扫文件尾序，丢弃 gs ≤ 当前尾的行——
 * 并发写者安全（同 gs 行只落一次）。返回实际追加的行数（0 = 全部被去重/无行）。
 */
export async function appendMirrorRows(path: string, rows: MirrorRow[]): Promise<number> {
	if (rows.length === 0) return 0;
	const tail = await readMirrorTail(path);
	const fresh = rows.filter((r) => r.gs > tail.gs);
	if (fresh.length === 0) return 0;
	try {
		mkdirSync(dirname(path), { recursive: true });
		await appendFile(path, `${fresh.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
	} catch {
		// 派生缓存写失败静默：尾序未推进，下次增量自然重拉这些行
		return 0;
	}
	return fresh.length;
}

/** 整文件重建镜像（rewrite 收缩场景；写失败静默） */
export async function rewriteMirrorRows(path: string, events: ReplayRow[]): Promise<void> {
	try {
		mkdirSync(dirname(path), { recursive: true });
		await writeFile(path, `${toMirrorRows(events).map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
	} catch {
		// 同上：派生缓存写失败静默
	}
}

/**
 * GET replay（增量参数可缺省）；离线/非 200/旧 server 无 lastSeq 时按行内 max 推导。
 * 返回 undefined = 不可达/失败（调用方按离线处理）。
 */
export async function fetchReplayRows(opts: {
	url: string;
	conversationId: string;
	token: string;
	since: number;
	fetchImpl?: MirrorFetch;
}): Promise<{ events: ReplayRow[]; lastSeq: number } | undefined> {
	const fetchImpl = opts.fetchImpl ?? ((i, j) => fetch(i, j));
	let response: Response;
	try {
		response = await fetchImpl(
			`${opts.url}/v1/journal/${encodeURIComponent(opts.conversationId)}/replay${opts.since > 0 ? `?since=${opts.since}` : ""}`,
			{ method: "GET", headers: { authorization: `Bearer ${opts.token}` } },
		);
	} catch {
		return undefined;
	}
	if (response.status !== 200) return undefined;
	const body = (await response.json()) as { events?: ReplayRow[]; lastSeq?: number };
	const events = body.events ?? [];
	const derived = events.reduce((max, e) => Math.max(max, e.seq ?? 0), 0);
	return { events, lastSeq: typeof body.lastSeq === "number" ? body.lastSeq : derived };
}

/**
 * main 侧预播种（纯云端化 ④）：把 server 账本增量落到本地镜像——会话打开（子进程
 * 对账）之前 renderer 的一次性 projectedHistory 读取就有数据可读。
 * 语义与 Http 服务 reconcileWithMirror 一致：尾扫增量；lastSeq < 尾序（他端 rewrite
 * 收缩/清空）→ since=0 全量重建。所有失败内部静默（离线时镜像维持原样）。
 */
export async function seedJournalMirrorFromServer(opts: {
	url: string;
	conversationId: string;
	mirrorPath: string;
	getAccessToken: () => Promise<string | undefined>;
	fetchImpl?: MirrorFetch;
}): Promise<void> {
	const token = await opts.getAccessToken();
	if (token === undefined) return;
	const tail = await readMirrorTail(opts.mirrorPath);
	let body = await fetchReplayRows({
		url: opts.url,
		conversationId: opts.conversationId,
		token,
		since: tail.gs,
		fetchImpl: opts.fetchImpl,
	});
	if (body === undefined) return;
	if (body.lastSeq < tail.gs) {
		body = await fetchReplayRows({
			url: opts.url,
			conversationId: opts.conversationId,
			token,
			since: 0,
			fetchImpl: opts.fetchImpl,
		});
		if (body === undefined) return;
		await rewriteMirrorRows(opts.mirrorPath, body.events);
		return;
	}
	await appendMirrorRows(opts.mirrorPath, toMirrorRows(body.events));
}
