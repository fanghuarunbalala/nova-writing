/**
 * HttpConversationJournalService 单元测试（FR2）：
 * - appendRun/appendRunMessages → POST 形态（JWT/租约/definitionVersion）与 serverLastSeq 跟踪；
 * - writeRuns → PUT rewrite + expectedLastSeq 乐观校验，409 抛 JournalRewriteConflictError；
 * - 断线路径：网络失败落 sidecar 待推队列（顺序保持），恢复后 open 补推清队；
 * - 积压超限 PendingPushOverflowError；
 * - 4xx（租约/认证）不落队列直接抛。
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	HttpConversationJournalService,
	JournalRewriteConflictError,
	PendingPushOverflowError,
	PENDING_PUSH_LIMIT,
} from "../persistence/HttpConversationJournalService.js";
import type { RunContext } from "../../runtime/loop/types.js";
import type { LLMessage } from "../../runtime/provider/types.js";

type RecordedRequest = { method: string; url: string; body: any; headers: Record<string, string> };

function makeFetch(responder: (req: RecordedRequest) => { status: number; body?: unknown } | "throw-network") {
	const requests: RecordedRequest[] = [];
	const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
		const req: RecordedRequest = {
			method: init?.method ?? "GET",
			url,
			body: init?.body !== undefined ? JSON.parse(String(init?.body)) : undefined,
			headers: (init?.headers ?? {}) as Record<string, string>,
		};
		requests.push(req);
		const result = responder(req);
		if (result === "throw-network") throw new Error("ECONNREFUSED");
		if (result.status === 204) return new Response(null, { status: 204 });
		return new Response(JSON.stringify(result.body ?? {}), { status: result.status, headers: { "content-type": "application/json" } });
	};
	return { requests, fetchImpl };
}

function run(seq: number, messages: LLMessage[]): RunContext {
	return { seq, messages } as unknown as RunContext;
}

function makeService(opts: {
	fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
	pendingPath: string;
	leaseToken?: string;
	definitionVersion?: string;
	mirrorPath?: string;
}) {
	return new HttpConversationJournalService({
		conversationId: "conv-1",
		url: "http://srv:8787",
		getAccessToken: async () => "jwt-token",
		getLeaseToken: () => opts.leaseToken ?? "lease-1",
		pendingPath: opts.pendingPath,
		...(opts.mirrorPath !== undefined ? { mirrorPath: opts.mirrorPath } : {}),
		...(opts.definitionVersion !== undefined ? { definitionVersion: opts.definitionVersion } : {}),
		fetchImpl: opts.fetchImpl,
	});
}

describe("HttpConversationJournalService", () => {
	it("appendRun/appendRunMessages：POST 形态（JWT+租约+版本）+ Receipt seq = run seq", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-hj-"));
		const { requests, fetchImpl } = makeFetch(() => ({ status: 201, body: { seq: 101 } }));
		const service = makeService({ fetchImpl, pendingPath: join(dir, "pending.jsonl"), definitionVersion: "1.5.0" });
		const receipt = await service.appendRun(run(3, [{ type: "user", content: "hi" } as LLMessage]));
		expect(receipt.seq).toBe(3);
		await service.appendRunMessages(3, [{ type: "assistant", content: "ok" } as LLMessage]);
		expect(service.lastSeq).toBe(3);
		expect(requests).toHaveLength(2);
		expect(requests[0]!.url).toBe("http://srv:8787/v1/runs/conv-1/events");
		expect(requests[0]!.headers.authorization).toBe("Bearer jwt-token");
		expect(requests[0]!.body).toMatchObject({ runSeq: 3, kind: "snapshot", leaseToken: "lease-1", definitionVersion: "1.5.0" });
		expect(requests[1]!.body.kind).toBe("append");
	});

	it("writeRuns：PUT rewrite 带 expectedLastSeq；409 → JournalRewriteConflictError（附当前值）", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-hj-"));
		let serverSeq = 5;
		const { requests, fetchImpl } = makeFetch((req) => {
			if (req.method === "POST") return { status: 201, body: { seq: ++serverSeq } };
			if (req.body.expectedLastSeq === serverSeq) return { status: 200, body: { lastSeq: ++serverSeq } };
			return { status: 409, body: { code: "stale_rewrite", currentLastSeq: serverSeq } };
		});
		const service = makeService({ fetchImpl, pendingPath: join(dir, "pending.jsonl") });
		await service.appendRun(run(1, []));
		await service.writeRuns([run(1, []), run(2, [])]);
		const put = requests.find((r) => r.method === "PUT")!;
		expect(put.url).toBe("http://srv:8787/v1/journal/conv-1/rewrite");
		expect(put.body.runs).toHaveLength(2);

		// 伪造并发写入后的 stale expectedLastSeq
		serverSeq += 1;
		await expect(service.writeRuns([run(9, [])])).rejects.toBeInstanceOf(JournalRewriteConflictError);
		await expect(service.writeRuns([run(9, [])])).rejects.toMatchObject({ currentLastSeq: serverSeq });
	});

	it("断线：append 网络失败落 sidecar（顺序保持）；恢复后 open 重放 + 补推清队", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-hj-"));
		const pendingPath = join(dir, "pending.jsonl");
		let online = false;
		const replay = { events: [{ seq: 1, run_seq: 0, kind: "snapshot", payload: [] }] };
		const pushed: number[] = [];
		const { fetchImpl } = makeFetch((req) => {
			if (!online) return "throw-network";
			if (req.method === "GET") return { status: 200, body: replay };
			pushed.push(req.body.runSeq);
			return { status: 201, body: { seq: 100 + pushed.length } };
		});
		const service = makeService({ fetchImpl, pendingPath });
		// 两写均失败（appendRun 抛 network 错但已入队）
		await expect(service.appendRun(run(1, []))).rejects.toThrow();
		await expect(service.appendRunMessages(1, [])).rejects.toThrow();
		expect(existsSync(pendingPath)).toBe(true);
		const queued = (await readFile(pendingPath, "utf8")).split("\n").filter(Boolean);
		expect(queued).toHaveLength(2);

		// 恢复：open → replay 对账 + 按序补推 + 清队
		online = true;
		await service.open();
		expect(pushed).toEqual([1, 1]);
		expect(existsSync(pendingPath)).toBe(false);
	});

	it("4xx（租约被拒）不落队列直接抛", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-hj-"));
		const pendingPath = join(dir, "pending.jsonl");
		const { fetchImpl } = makeFetch(() => ({ status: 423, body: { code: "lease_taken", message: "他端持有" } }));
		const service = makeService({ fetchImpl, pendingPath });
		await expect(service.appendRun(run(1, []))).rejects.toMatchObject({ code: "lease_taken" });
		expect(existsSync(pendingPath)).toBe(false);
	});

	it("积压超限：PendingPushOverflowError（不落队列）", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-hj-"));
		const pendingPath = join(dir, "pending.jsonl");
		await writeFile(pendingPath, `${Array.from({ length: PENDING_PUSH_LIMIT }, (_, i) => JSON.stringify({ runSeq: i, kind: "append", messages: [] })).join("\n")}\n`, "utf8");
		const { fetchImpl } = makeFetch(() => "throw-network");
		const service = makeService({ fetchImpl, pendingPath });
		await expect(service.appendRunMessages(99, [])).rejects.toBeInstanceOf(PendingPushOverflowError);
		await rm(dir, { recursive: true, force: true });
	});
});

describe("HttpConversationJournalService 本地镜像（纯云端化 FR2）", () => {
	/** 读镜像文件为已解析行 */
	async function readMirror(path: string): Promise<any[]> {
		const raw = await readFile(path, "utf8");
		return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
	}

	it("POST 成功写通镜像（snapshot 行带 run / append 行带 messages，均含 gs）", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-hj-m-"));
		const mirrorPath = join(dir, "journal.jsonl");
		try {
			let seq = 100;
			const { fetchImpl } = makeFetch((req) => {
				if (req.method === "POST") return { status: 201, body: { seq: ++seq } };
				return { status: 200, body: { events: [], lastSeq: 0 } };
			});
			const service = makeService({ fetchImpl, pendingPath: join(dir, "pending.jsonl"), mirrorPath });
			await service.appendRun(run(3, [{ type: "user", content: "hi" } as LLMessage]));
			await service.appendRunMessages(3, [{ type: "assistant", content: "ok" } as LLMessage]);
			const rows = await readMirror(mirrorPath);
			expect(rows).toHaveLength(2);
			expect(rows[0]).toMatchObject({ seq: 3, kind: "snapshot", gs: 101 });
			expect(rows[0]!.run).toMatchObject({ seq: 3 });
			expect(rows[1]).toMatchObject({ seq: 3, kind: "append", gs: 102 });
			expect(rows[1]!.messages).toHaveLength(1);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("上推失败（网络/4xx/5xx）不写镜像——server 权威未确认前镜像不落", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-hj-m-"));
		const mirrorPath = join(dir, "journal.jsonl");
		try {
			const { fetchImpl } = makeFetch(() => "throw-network");
			const service = makeService({ fetchImpl, pendingPath: join(dir, "pending.jsonl"), mirrorPath });
			await expect(service.appendRun(run(1, []))).rejects.toThrow();
			const fourxx = makeFetch(() => ({ status: 423, body: { code: "lease_taken" } }));
			const s2 = makeService({ fetchImpl: fourxx.fetchImpl, pendingPath: join(dir, "p2.jsonl"), mirrorPath });
			await expect(s2.appendRunMessages(1, [])).rejects.toMatchObject({ code: "lease_taken" });
			expect(existsSync(mirrorPath)).toBe(false);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("open 增量对账：镜像尾 gs 为 since；增量行合并追加；离线沿用镜像", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-hj-m-"));
		const mirrorPath = join(dir, "journal.jsonl");
		try {
			// 预置镜像：一条 gs=5 的 append 行
			await writeFile(
				mirrorPath,
				`${JSON.stringify({ seq: 1, kind: "append", messages: [{ type: "user", content: "旧" }], ts: "t", gs: 5 })}\n`,
				"utf8",
			);
			const seenSince: number[] = [];
			const { requests, fetchImpl } = makeFetch((req) => {
				if (req.method === "GET") {
					seenSince.push(Number(new URL(req.url).searchParams.get("since") ?? "0"));
					return {
						status: 200,
						body: {
							events: [
								{ seq: 7, run_seq: 2, kind: "snapshot", payload: JSON.stringify([{ seq: 2, messages: [] }]) },
								{ seq: 9, run_seq: 2, kind: "append", payload: JSON.stringify([{ type: "user", content: "新" }]) },
								// 非 message 行不入镜像
								{ seq: 10, run_seq: -1, kind: "memory-write", payload: "{}" },
							],
							lastSeq: 10,
						},
					};
				}
				return { status: 201, body: { seq: 11 } };
			});
			const service = makeService({ fetchImpl, pendingPath: join(dir, "pending.jsonl"), mirrorPath });
			await service.open();
			expect(seenSince).toEqual([5]); // 增量拉取（非全量）
			const rows = await readMirror(mirrorPath);
			expect(rows).toHaveLength(3); // 旧 1 + snapshot 1 + append 1（memory-write 不入）
			expect(rows[1]).toMatchObject({ seq: 2, kind: "snapshot", gs: 7 });
			expect(rows[2]).toMatchObject({ seq: 2, kind: "append", gs: 9 });
			// 对齐两游标
			expect(service.lastSeq).toBe(2);

			// 离线：GET 抛网络错 → 镜像原样（不炸、不重建）
			const offline = makeFetch(() => "throw-network");
			const s2 = makeService({ fetchImpl: offline.fetchImpl, pendingPath: join(dir, "p2.jsonl"), mirrorPath });
			await expect(s2.open()).resolves.toBeUndefined();
			expect((await readMirror(mirrorPath)).length).toBe(3);
			void requests;
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("lastSeq < 镜像尾（他端 rewrite 收缩）→ 全量重建镜像", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-hj-m-"));
		const mirrorPath = join(dir, "journal.jsonl");
		try {
			await writeFile(
				mirrorPath,
				`${JSON.stringify({ seq: 1, kind: "append", messages: [], ts: "t", gs: 50 })}\n`,
				"utf8",
			);
			const sinces: number[] = [];
			const { fetchImpl } = makeFetch((req) => {
				if (req.method === "GET") {
					sinces.push(Number(new URL(req.url).searchParams.get("since") ?? "0"));
					return {
						status: 200,
						// 第一次（since=50）：lastSeq=0 < 50 → 触发收缩；第二次（since=0）：空账本
						body: { events: [], lastSeq: 0 },
					};
				}
				return { status: 201, body: { seq: 1 } };
			});
			const service = makeService({ fetchImpl, pendingPath: join(dir, "pending.jsonl"), mirrorPath });
			await service.open();
			expect(sinces).toEqual([50, 0]); // 先增量发现收缩，再全量重建
			expect((await readMirror(mirrorPath)).length).toBe(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("writeRuns 成功 → 镜像全量重放重建（新行逐行 gs 未知）", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-hj-m-"));
		const mirrorPath = join(dir, "journal.jsonl");
		try {
			let serverSeq = 5;
			const { fetchImpl } = makeFetch((req) => {
				if (req.method === "POST") return { status: 201, body: { seq: ++serverSeq } };
				if (req.method === "PUT") return { status: 200, body: { lastSeq: ++serverSeq } };
				return {
					status: 200,
					body: {
						events: [{ seq: serverSeq, run_seq: 1, kind: "snapshot", payload: JSON.stringify([{ seq: 1, messages: [{ type: "user", content: "压缩" }] }]) }],
						lastSeq: serverSeq,
					},
				};
			});
			const service = makeService({ fetchImpl, pendingPath: join(dir, "pending.jsonl"), mirrorPath });
			await service.appendRun(run(1, [{ type: "user", content: "旧" } as LLMessage]));
			expect((await readMirror(mirrorPath))).toHaveLength(1);
			await service.writeRuns([run(1, [{ type: "user", content: "压缩" } as LLMessage])]);
			const rows = await readMirror(mirrorPath);
			expect(rows).toHaveLength(1); // 重建后只剩 rewrite 后的权威行
			expect(rows[0]).toMatchObject({ seq: 1, kind: "snapshot", gs: serverSeq });
			expect(rows[0]!.run.messages[0]).toMatchObject({ content: "压缩" });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("drainPending 补推成功也写镜像（断线恢复不缺行）", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-hj-m-"));
		const mirrorPath = join(dir, "journal.jsonl");
		const pendingPath = join(dir, "pending.jsonl");
		try {
			let online = false;
			let seq = 200;
			const { fetchImpl } = makeFetch((req) => {
				if (!online) return "throw-network";
				if (req.method === "GET") return { status: 200, body: { events: [], lastSeq: 0 } };
				return { status: 201, body: { seq: ++seq } };
			});
			const service = makeService({ fetchImpl, pendingPath, mirrorPath });
			await expect(service.appendRunMessages(1, [{ type: "user", content: "离线写" } as LLMessage])).rejects.toThrow();
			expect(existsSync(mirrorPath)).toBe(false); // 失败不写镜像
			online = true;
			await service.open(); // 补推清队
			const rows = await readMirror(mirrorPath);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({ seq: 1, kind: "append", gs: 201 });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("竞态去重（纯云端化 ④）：写通行已在盘后，拉回同批行不重复落盘（gs 追加时点过滤）", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-hj-m-"));
		const mirrorPath = join(dir, "journal.jsonl");
		try {
			// fetch 无视 since 恒返 gs=23/24 两行（模拟「尾扫描→fetch」窗口滞后于写通路径）
			const { fetchImpl } = makeFetch((req) => {
				if (req.method === "POST") return { status: 201, body: { seq: req.body.runSeq === 1 ? 23 : 24 } };
				return {
					status: 200,
					body: {
						events: [
							{ seq: 23, run_seq: 1, kind: "snapshot", payload: JSON.stringify([{ seq: 1, messages: [] }]) },
							{ seq: 24, run_seq: 1, kind: "append", payload: JSON.stringify([{ type: "user", content: "x" }]) },
						],
						lastSeq: 24,
					},
				};
			});
			const service = makeService({ fetchImpl, pendingPath: join(dir, "pending.jsonl"), mirrorPath });
			await service.open(); // 初始对账（拉回 23/24 并落盘——冷启动全量）
			await service.appendRun(run(1, [])); // POST 201 → gs=23 写通（已在盘，去重）
			await service.appendRunMessages(1, []); // POST 201 → gs=24 写通（同上）
			await service.reconcile(); // 再对账：fetch 仍回 23/24 → 追加时点过滤，不重复
			const rows = await readMirror(mirrorPath);
			expect(rows).toHaveLength(2); // gs=23/24 各一次
			expect(rows.map((r: any) => r.gs)).toEqual([23, 24]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
