/**
 * 桌面数据通道契约测试 + e2e（PRD 桌面接入 FR8 验收）：
 * - 契约套件（describe.each 双实现）：FileConversationJournalService（本地 JSONL）与
 *   HttpConversationJournalService（真起 server）跑同一套用例——append 折叠 / writeRuns 重写 /
 *   lastSeq 语义（run 级），接口行为不漂移；
 * - e2e 全时序（PRD 3.2）：登录 → 租约（LeaseClient，互斥 409）→ Http journal 上推 →
 *   ServerEventBridge SSE 实时收 → 审批两段式跨端 resolve → rewrite 409 自纠。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	FileConversationJournalService,
	FileConversationJournalReadOnlyService,
	HttpConversationJournalService,
	JournalRewriteConflictError,
	LeaseClient,
	LeaseHeldError,
	ServerApprovalChannel,
	ServerEventBridge,
	type ConversationJournalService,
	type LLMessage,
	type RunContext,
	type ServerStreamEvent,
} from "@novel/core";
import type { Db } from "./db.js";
import type { SseHub } from "./sse.js";
import { auth, loginUser, openSse, registerUser, type Session } from "./test-util.js";

function run(seq: number, messages: LLMessage[]): RunContext {
	return { seq, messages } as unknown as RunContext;
}
const user = (content: string): LLMessage => ({ type: "user", content } as unknown as LLMessage);

/** 双实现工厂：返回 { impl, readRuns } —— 读模型各自实现（本地折叠 vs server 重放折叠） */
interface JournalImpl {
	name: string;
	impl: ConversationJournalService;
	readRuns(): Promise<Array<{ seq: number; messages: LLMessage[] }>>;
}

describe("桌面数据通道", () => {
	let app: FastifyInstance;
	let db: Db;
	let hub: SseHub;
	let baseUrl: string;
	let session: Session;
	let leaseToken: string;

	beforeAll(async () => {
		const built = await (await import("./index.js")).buildServer({ secret: "contract-secret" });
		app = built.app;
		db = built.db;
		hub = built.hub;
		await app.listen({ port: 0, host: "127.0.0.1" });
		const address = app.addresses()[0]!;
		baseUrl = `http://${address.address}:${address.port}`;
		session = await registerUser(app, "contract-author", "桌面");
		const leaseRes = await app.inject({ method: "POST", url: "/v1/leases", headers: auth(session), payload: { conversationId: "conv-contract" } });
		leaseToken = (leaseRes.json() as { leaseToken: string }).leaseToken;
	});
	afterAll(async () => {
		await app.close();
	});

	async function makeImpls(conversationId: string): Promise<JournalImpl[]> {
		const dir = await mkdtemp(join(tmpdir(), "nova-contract-"));
		// 每会话各自申请租约（server 按会话仲裁）
		const leaseRes = await app.inject({ method: "POST", url: "/v1/leases", headers: auth(session), payload: { conversationId } });
		const convLease = (leaseRes.json() as { leaseToken: string }).leaseToken;
		const file = new FileConversationJournalService({ conversationId, filePath: join(dir, conversationId, "journal.jsonl") });
		const fileReader = new FileConversationJournalReadOnlyService({ journalDir: dir });
		const http = new HttpConversationJournalService({
			conversationId,
			url: baseUrl,
			getAccessToken: async () => session.accessToken,
			getLeaseToken: () => convLease,
			pendingPath: join(dir, "pending-push.jsonl"),
			definitionVersion: "1.5.0",
		});
		return [
			{
				name: "FileConversationJournalService（本地 JSONL）",
				impl: file,
				readRuns: () => fileReader.readRuns(conversationId).then((rs) => rs.map((r) => ({ seq: r.seq, messages: r.messages }))),
			},
			{
				name: "HttpConversationJournalService（server REST）",
				impl: http,
				readRuns: async () => {
					const token = session.accessToken;
					const res = await fetch(`${baseUrl}/v1/journal/${conversationId}/replay`, { headers: { authorization: `Bearer ${token}` } });
					const body = (await res.json()) as { events: Array<{ seq: number; run_seq: number; kind: string; payload: string }> };
					const byRun = new Map<number, { seq: number; messages: LLMessage[] }>();
					for (const e of body.events) {
						const payload = JSON.parse(e.payload) as unknown;
						if (e.kind === "snapshot") {
							const r = Array.isArray(payload) ? (payload[0] as { messages?: LLMessage[] }) : undefined;
							byRun.set(e.run_seq, { seq: e.run_seq, messages: r?.messages ?? [] });
						} else if (byRun.has(e.run_seq)) {
							byRun.get(e.run_seq)!.messages.push(...((Array.isArray(payload) ? payload : []) as LLMessage[]));
						}
					}
					return [...byRun.values()].sort((a, b) => a.seq - b.seq);
				},
			},
		];
	}

	// 同一契约用例集：双实现行为一致（FR8）。实现数组在 beforeAll 建（顶层 await 不可用）。
	let implGroups: Array<Array<JournalImpl>>;
	beforeAll(async () => {
		implGroups = await Promise.all(["conv-c1", "conv-c2"].map((id) => makeImpls(id)));
	});
	for (const [groupIdx, convId] of ["conv-c1", "conv-c2"].entries()) {
		for (const implIdx of [0, 1]) {
			const label = `${implIdx === 0 ? "File（本地 JSONL）" : "Http（server REST）"}（${convId}）`;
			describe(`契约用例：${label}`, () => {
				const getImpl = (): JournalImpl => {
					const impl = implGroups[groupIdx]?.[implIdx];
					if (impl === undefined) throw new Error("impl 未初始化");
					return impl;
				};
				it("appendRun + appendRunMessages：读模型折叠一致；Receipt.seq = run seq", async () => {
					const { impl, readRuns } = getImpl();
					await impl.open();
					const r1 = await impl.appendRun(run(1, [user("第一章"), user("续写")]));
					expect(r1.seq).toBe(1);
					await impl.appendRunMessages(1, [user("追加")]);
					await impl.appendRun(run(2, [user("第二章")]));
					expect(impl.lastSeq).toBe(2);
					const runs = await readRuns();
					expect(runs.map((r) => r.seq)).toEqual([1, 2]);
					expect(runs[0]!.messages.map((m: any) => m.content)).toEqual(["第一章", "续写", "追加"]);
				});
				it("writeRuns：压缩后全量重写，读模型只剩新基线", async () => {
					const { impl, readRuns } = getImpl();
					await impl.writeRuns([run(1, [user("摘要")]), run(3, [user("新 run")])]);
					expect(impl.lastSeq).toBe(3);
					const runs = await readRuns();
					expect(runs.map((r) => r.seq)).toEqual([1, 3]);
					expect(runs[0]!.messages.map((m: any) => m.content)).toEqual(["摘要"]);
				});
				it("open 幂等（重复打开不炸、lastSeq 保持）", async () => {
					const { impl } = getImpl();
					const before = impl.lastSeq;
					await impl.open();
					expect(impl.lastSeq).toBe(before);
				});
			});
		}
	}

	it("e2e：租约互斥 → SSE 实时 → 审批跨端 resolve → rewrite 冲突自纠", { timeout: 30_000 }, async () => {
		// 0. 续租（前面契约用例耗时可能已过 60s TTL；同设备续租 token 不变）
		const renew = await app.inject({ method: "POST", url: "/v1/leases", headers: auth(session), payload: { conversationId: "conv-contract" } });
		leaseToken = (renew.json() as { leaseToken: string }).leaseToken;
		// 1. 另一设备（同账号另一 session）抢租约 → LeaseHeldError
		const other = await loginUser(app, "contract-author", "手机");
		const otherLease = new LeaseClient({ url: baseUrl, conversationId: "conv-contract", getAccessToken: async () => other.accessToken });
		await expect(otherLease.acquire()).rejects.toBeInstanceOf(LeaseHeldError);

		// 2. SSE 桥实时收桌面 Http journal 上推
		const events: ServerStreamEvent[] = [];
		const bridge = new ServerEventBridge({
			url: baseUrl,
			conversationId: "conv-contract",
			getAccessToken: async () => other.accessToken,
			onEvent: (e) => events.push(e),
		});
		bridge.start();
		const journal = new HttpConversationJournalService({
			conversationId: "conv-contract",
			url: baseUrl,
			getAccessToken: async () => session.accessToken,
			getLeaseToken: () => leaseToken,
			pendingPath: join(await mkdtemp(join(tmpdir(), "nova-e2e-")), "pending.jsonl"),
		});
		await journal.open();
		await journal.appendRun(run(5, [user("e2e run")]));
		await vi.waitFor(() => expect(events.some((e) => e.type === "journal" && e.seq !== undefined)).toBe(true), { timeout: 5000 });

		// 3. 审批两段式：桌面 submit → 手机（另一 session）resolve → SSE approval_resolved
		const approvals = new ServerApprovalChannel({
			url: baseUrl,
			getAccessToken: async () => session.accessToken,
			getLeaseToken: () => leaseToken,
		});
		await approvals.submit({ conversationId: "conv-contract", requestId: "approval:conv-contract:5:b1", runSeq: 5, calls: [{ name: "write_file" }] });
		const phoneApprovals = new ServerApprovalChannel({
			url: baseUrl,
			getAccessToken: async () => other.accessToken,
			getLeaseToken: () => undefined,
		});
		await phoneApprovals.resolve("approval:conv-contract:5:b1", "approve");
		await vi.waitFor(() => expect(events.some((e) => e.type === "approval_resolved" && e.requestId === "approval:conv-contract:5:b1")).toBe(true), { timeout: 5000 });

		// 4. rewrite 冲突：绕过 journal 直接 inject 一条（模拟并发写入）→ journal 的
		//    expectedLastSeq 已过期 → writeRuns 409 → reconcile 重放自纠后重写成功
		await app.inject({
			method: "POST", url: "/v1/runs/conv-contract/events", headers: auth(session),
			payload: { runSeq: 5, kind: "append", messages: [user("并发写入")], leaseToken },
		});
		await expect(journal.writeRuns([run(9, [])])).rejects.toBeInstanceOf(JournalRewriteConflictError);
		await journal.reconcile();
		await journal.writeRuns([run(9, [user("压缩后")])]);
		await bridge.stop();

		// 5. server 重放终态
		const replay = await (await fetch(`${baseUrl}/v1/journal/conv-contract/replay`, { headers: { authorization: `Bearer ${other.accessToken}` } })).json() as { events: any[] };
		expect(replay.events.filter((e) => e.kind === "append").length).toBe(0);
	});
});
