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
}) {
	return new HttpConversationJournalService({
		conversationId: "conv-1",
		url: "http://srv:8787",
		getAccessToken: async () => "jwt-token",
		getLeaseToken: () => opts.leaseToken ?? "lease-1",
		pendingPath: opts.pendingPath,
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
