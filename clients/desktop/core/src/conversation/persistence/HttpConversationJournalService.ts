/**
 * HttpConversationJournalService：journal 写侧的 server 模式实现（PRD 桌面接入 FR2）。
 * - 与 FileConversationJournalService 同契约（appendRun/appendRunMessages/writeRuns…）；
 * - append → POST /v1/runs/:id/events（JWT + 租约）；writeRuns → PUT /v1/journal/:id/rewrite
 *   （expectedLastSeq 乐观校验，并发覆盖 409 附当前值——上层重放后重试或提示）；
 * - 断线队列：journal 同目录 sidecar `pending-push.jsonl`（开放问题②敲定），顺序补推，
 *   上限 10k 行（超限抛错提示转只读，防静默丢写）；
 * - 契约的 lastSeq 语义 = run seq（与文件实现一致）；server 账本全局行号单独跟踪（rewrite 校验用）。
 */

import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { appendFile, readFile, writeFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunContext } from "../../runtime/loop/types.js";
import type { LLMessage } from "../../runtime/provider/types.js";
import type { Receipt } from "../contract/types/index.js";
import type { ConversationJournalService as Contract } from "../contract/journal/index.js";
import { ServerAuthError } from "../../config/serverAuth.js";
import {
	appendMirrorRows,
	fetchReplayRows,
	mirrorRowOf,
	readMirrorTail,
	rewriteMirrorRows,
	toMirrorRows,
	type MirrorRow,
	type ReplayRow,
} from "./journalMirror.js";

/** 可注入 fetch（测试） */
export type HttpJournalFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** 断线积压上限（PRD 开放问题②：超限停写转只读提示，防静默丢写） */
export const PENDING_PUSH_LIMIT = 10_000;

/** server 返回的错误体 */
interface ServerErrorBody {
	code?: string;
	message?: string;
	currentLastSeq?: number;
}

/** rewrite 并发覆盖冲突（409）：上层重放后重试或提示用户 */
export class JournalRewriteConflictError extends Error {
	constructor(readonly currentLastSeq: number) {
		super(`账本已被并发写入（当前末序 ${currentLastSeq}），请重放后重试`);
		this.name = "JournalRewriteConflictError";
	}
}

/** 断线积压超限（写入方应停止并转只读提示） */
export class PendingPushOverflowError extends Error {
	constructor(readonly limit: number) {
		super(`断线积压超过上限 ${limit}，请恢复连接后重试`);
		this.name = "PendingPushOverflowError";
	}
}

export interface HttpConversationJournalServiceOptions {
	/** conversation id（server 路由参数） */
	conversationId: string;
	/** server 基址 */
	url: string;
	/** JWT access 取得（ServerAuthSession.ensureAccessToken） */
	getAccessToken: () => Promise<string | undefined>;
	/** 租约 token（run 生命周期内有效；server 校验写权限） */
	getLeaseToken: () => string | undefined;
	/** sidecar 断线队列文件路径（journal 同目录） */
	pendingPath: string;
	/**
	 * 本地镜像文件路径（纯云端化 FR2，= File 版 journal.jsonl 同位）：server 权威的只读
	 * 性能副本——POST/PUT 成功后写通；恢复路径「镜像折叠 + replay?since= 增量合并」。
	 * 缺省不启用（旧行为：无本地文件）。
	 */
	mirrorPath?: string;
	/** 附加定义包版本（账本行透传） */
	definitionVersion?: string;
	/** 可注入 fetch */
	fetchImpl?: HttpJournalFetch;
}

/** 单条待推事件（append 类；顺序保持） */
interface PendingEvent {
	runSeq: number;
	kind: "snapshot" | "append";
	messages: unknown[];
}

/** journal 写侧 server 实现（append 上推 + rewrite 全量重写 + 断线 sidecar 补推） */
export class HttpConversationJournalService implements Contract {
	private readonly opts: HttpConversationJournalServiceOptions;
	private readonly fetchImpl: HttpJournalFetch;
	private lastRunSeq = 0;
	/** server 账本全局末序（rewrite 乐观校验基线；POST 响应/PUT 响应更新） */
	private serverLastSeq = 0;
	/** 镜像尾 gs 的内存值（postEvent 写通后即时推进——reconcile 增量不重拉自身已落行；
	 *  文件写失败静默时不推进，下次自然重拉。文件侧另有追加时点去重兜底并发） */
	private mirrorTailGs = 0;
	/** 串行推流队列（调用序 = 上推序；断线时入 sidecar 队列） */
	private pushChain: Promise<void> = Promise.resolve();

	constructor(opts: HttpConversationJournalServiceOptions) {
		this.opts = opts;
		this.fetchImpl = opts.fetchImpl ?? ((i, j) => fetch(i, j));
	}

	/** 打开：重放对账（恢复 serverLastSeq / lastRunSeq） + 补推断线积压 */
	async open(): Promise<void> {
		mkdirSync(dirname(this.opts.pendingPath), { recursive: true });
		await this.reconcile();
		await this.drainPending();
	}

	get lastSeq(): number {
		return this.lastRunSeq;
	}

	async appendRun(run: RunContext): Promise<Receipt> {
		this.lastRunSeq = Math.max(this.lastRunSeq, run.seq);
		const messages: unknown[] = [run];
		await this.enqueuePush({ runSeq: run.seq, kind: "snapshot", messages });
		return { seq: run.seq, recordedAt: new Date().toISOString() };
	}

	async appendRunMessages(seq: number, messages: LLMessage[]): Promise<Receipt> {
		this.lastRunSeq = Math.max(this.lastRunSeq, seq);
		await this.enqueuePush({ runSeq: seq, kind: "append", messages });
		return { seq, recordedAt: new Date().toISOString() };
	}

	async writeRuns(runs: RunContext[]): Promise<void> {
		this.lastRunSeq = runs.reduce((max, r) => Math.max(max, r.seq), 0);
		const body = {
			expectedLastSeq: this.serverLastSeq,
			leaseToken: this.opts.getLeaseToken(),
			runs: runs.map((r) => ({ runSeq: r.seq, messages: [r] as unknown[] })),
		};
		const next = this.pushChain.then(() => this.putRewrite(body), () => this.putRewrite(body));
		this.pushChain = next.catch(() => {});
		await next;
	}

	async flush(): Promise<void> {
		await this.pushChain;
	}

	async close(): Promise<void> {
		await this.flush();
	}

	/** 崩溃恢复/对账：有镜像走增量（replay?since=镜像尾 gs），无镜像保持全量；
	 *  对齐 serverLastSeq（账本全局末序，rewrite 校验基线）与 lastRunSeq（run 级） */
	async reconcile(): Promise<void> {
		const token = await this.opts.getAccessToken();
		if (token === undefined) return;
		if (this.opts.mirrorPath !== undefined) {
			await this.reconcileWithMirror(token);
			return;
		}
		const body = await this.fetchReplay(token, 0);
		if (body === undefined) return;
		for (const event of body.events) {
			this.serverLastSeq = Math.max(this.serverLastSeq, event.seq ?? 0);
			this.lastRunSeq = Math.max(this.lastRunSeq, event.run_seq ?? 0);
		}
	}

	/** GET replay 委托（journalMirror 模块；离线/非 200 → undefined） */
	private fetchReplay(token: string, since: number): Promise<{ events: ReplayRow[]; lastSeq: number } | undefined> {
		return fetchReplayRows({
			url: this.opts.url,
			conversationId: this.opts.conversationId,
			token,
			since,
			fetchImpl: this.fetchImpl,
		});
	}

	/** 镜像增量对账：since = max(内存尾, 文件尾)；lastSeq < 尾序 = 账本被 rewrite 收缩 → 全量重建镜像 */
	private async reconcileWithMirror(token: string): Promise<void> {
		const path = this.opts.mirrorPath!;
		const fileTail = await readMirrorTail(path);
		const tail = Math.max(this.mirrorTailGs, fileTail.gs);
		this.lastRunSeq = Math.max(this.lastRunSeq, fileTail.runSeq);
		let body = await this.fetchReplay(token, tail);
		if (body === undefined) return;
		if (body.lastSeq < tail) {
			body = await this.fetchReplay(token, 0);
			if (body === undefined) return;
			await rewriteMirrorRows(path, body.events);
			this.mirrorTailGs = body.lastSeq;
		} else {
			const appended = await appendMirrorRows(
				path,
				toMirrorRows(body.events.filter((e) => (e.seq ?? 0) > tail)),
			);
			if (appended > 0) this.mirrorTailGs = Math.max(this.mirrorTailGs, body.lastSeq);
		}
		this.serverLastSeq = Math.max(this.serverLastSeq, body.lastSeq);
		for (const event of body.events) {
			this.lastRunSeq = Math.max(this.lastRunSeq, event.run_seq ?? 0);
		}
	}

	/** 待推事件写通镜像（POST 201 后）：去重安全，追加成功才推进内存尾 */
	private async appendMirror(event: PendingEvent, gs: number): Promise<void> {
		const path = this.opts.mirrorPath;
		if (path === undefined) return;
		const row: MirrorRow = mirrorRowOf(event, gs);
		if ((await appendMirrorRows(path, [row])) > 0) {
			this.mirrorTailGs = Math.max(this.mirrorTailGs, gs);
		}
	}

	/** 入队一次 append 上推：成功更新 serverLastSeq；网络失败落 sidecar 队列 */
	private enqueuePush(event: PendingEvent): Promise<void> {
		const next = this.pushChain.then(
			() => this.postEvent(event),
			() => this.postEvent(event),
		);
		this.pushChain = next.catch(() => {});
		return next;
	}

	private async postEvent(event: PendingEvent): Promise<void> {
		const token = await this.opts.getAccessToken();
		const leaseToken = this.opts.getLeaseToken();
		if (token === undefined) throw new ServerAuthError("not_logged_in", "server 未登录");
		if (leaseToken === undefined) throw new ServerAuthError("lease_required", "缺少租约");
		let response: Response;
		try {
			response = await this.fetchImpl(`${this.opts.url}/v1/runs/${encodeURIComponent(this.opts.conversationId)}/events`, {
				method: "POST",
				headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
				body: JSON.stringify({
					runSeq: event.runSeq,
					kind: event.kind,
					messages: event.messages,
					...(this.opts.definitionVersion !== undefined ? { definitionVersion: this.opts.definitionVersion } : {}),
					leaseToken,
				}),
			});
		} catch (cause) {
			await this.appendToPending(event);
			throw new ServerAuthError("network_unreachable", `上推失败已入本地待推队列：${String(cause)}`);
		}
		if (response.status === 201) {
			const body = (await response.json()) as { seq: number };
			this.serverLastSeq = Math.max(this.serverLastSeq, body.seq);
			await this.appendMirror(event, body.seq);
			return;
		}
		if (response.status >= 500) {
			await this.appendToPending(event);
			throw new ServerAuthError(`http_${response.status}`, `server 错误已入本地待推队列`);
		}
		// 4xx（租约/认证类）：不落队列（重试无意义），直接抛给上层
		const body = (await response.json().catch(() => ({}))) as ServerErrorBody;
		throw new ServerAuthError(body.code ?? `http_${response.status}`, body.message ?? `上推被拒 ${response.status}`, response.status);
	}

	private async putRewrite(body: {
		expectedLastSeq: number;
		leaseToken: string | undefined;
		runs: Array<{ runSeq: number; messages: unknown[] }>;
	}): Promise<void> {
		const token = await this.opts.getAccessToken();
		if (token === undefined) throw new ServerAuthError("not_logged_in", "server 未登录");
		if (body.leaseToken === undefined) throw new ServerAuthError("lease_required", "缺少租约");
		const response = await this.fetchImpl(`${this.opts.url}/v1/journal/${encodeURIComponent(this.opts.conversationId)}/rewrite`, {
			method: "PUT",
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		if (response.status === 200) {
			const result = (await response.json()) as { lastSeq: number };
			this.serverLastSeq = result.lastSeq;
			// rewrite 后新行逐行全局 seq 未知 → 全量重放一次重建镜像（rewrite 罕见，代价可接受）
			if (this.opts.mirrorPath !== undefined) {
				const token = await this.opts.getAccessToken();
				const body = token !== undefined ? await this.fetchReplay(token, 0) : undefined;
				if (body !== undefined) {
					await rewriteMirrorRows(this.opts.mirrorPath, body.events);
					this.mirrorTailGs = Math.max(this.mirrorTailGs, body.lastSeq);
				}
			}
			return;
		}
		if (response.status === 409) {
			const result = (await response.json()) as ServerErrorBody;
			throw new JournalRewriteConflictError(result.currentLastSeq ?? 0);
		}
		const errorBody = (await response.json().catch(() => ({}))) as ServerErrorBody;
		throw new ServerAuthError(errorBody.code ?? `http_${response.status}`, errorBody.message ?? `重写被拒 ${response.status}`, response.status);
	}

	// ---- sidecar 断线队列 ----

	private async appendToPending(event: PendingEvent): Promise<void> {
		const existing = existsSync(this.opts.pendingPath)
			? readFileSync(this.opts.pendingPath, "utf8").split("\n").filter(Boolean).length
			: 0;
		if (existing >= PENDING_PUSH_LIMIT) throw new PendingPushOverflowError(PENDING_PUSH_LIMIT);
		await appendFile(this.opts.pendingPath, `${JSON.stringify(event)}\n`, "utf8");
	}

	/** 恢复后按序补推积压；单条失败停止（保序），等待下次恢复 */
	private async drainPending(): Promise<void> {
		if (!existsSync(this.opts.pendingPath)) return;
		const raw = await readFile(this.opts.pendingPath, "utf8");
		const lines = raw.split("\n").filter(Boolean);
		if (lines.length === 0) {
			await rm(this.opts.pendingPath, { force: true });
			return;
		}
		const events: PendingEvent[] = [];
		for (const line of lines) {
			try {
				events.push(JSON.parse(line) as PendingEvent);
			} catch {
				// 损坏行丢弃（末尾半行容忍，同文件实现）
			}
		}
		let sent = 0;
		for (const event of events) {
			try {
				// 复用 postEvent 的成功路径但不二次落队：离线时直接中止
				const ok = await this.tryPostDirect(event);
				if (!ok) break;
				sent += 1;
			} catch (cause) {
				if (cause instanceof PendingPushOverflowError) throw cause;
				break;
			}
		}
		if (sent === events.length) {
			await rm(this.opts.pendingPath, { force: true });
		} else {
			await writeFile(this.opts.pendingPath, events.slice(sent).map((e) => JSON.stringify(e)).join("\n") + (sent < events.length ? "\n" : ""), "utf8");
		}
	}

	/** 不落队列的直推（补推路径专用；网络失败返回 false 而非抛错） */
	private async tryPostDirect(event: PendingEvent): Promise<boolean> {
		const token = await this.opts.getAccessToken();
		const leaseToken = this.opts.getLeaseToken();
		if (token === undefined || leaseToken === undefined) return false;
		try {
			const response = await this.fetchImpl(`${this.opts.url}/v1/runs/${encodeURIComponent(this.opts.conversationId)}/events`, {
				method: "POST",
				headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
				body: JSON.stringify({ runSeq: event.runSeq, kind: event.kind, messages: event.messages, leaseToken }),
			});
			if (response.status !== 201) return false;
			const body = (await response.json()) as { seq: number };
			this.serverLastSeq = Math.max(this.serverLastSeq, body.seq);
			await this.appendMirror(event, body.seq);
			return true;
		} catch {
			return false;
		}
	}
}
