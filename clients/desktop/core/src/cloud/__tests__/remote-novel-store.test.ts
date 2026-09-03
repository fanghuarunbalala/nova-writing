/**
 * RemoteNovelStore 单元测试（FR6，fetch mock）：
 * 投影+oplog 语义——首 query 触发 snapshot 重放；mutate 本地应用 + oplog 上行；
 * delta 增量重放（本会话跳过 / 他会话应用）；上推失败抛错。
 * 真契约集成见 cloud/server 包 cloud-novel-store.test.ts。
 */
import { describe, expect, it, vi } from "vitest";
import { RemoteNovelStore } from "../../cloud/RemoteNovelStore.js";

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makeHarness() {
	const oplog: Array<{ id: string; kind: string; seq: number; data: unknown }> = [];
	let seq = 0;
	const requests: string[] = [];
	const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
		const method = init?.method ?? "GET";
		requests.push(`${method} ${url.replace(/^.*\/v1/, "")}`);
		if (url.includes("/domain/snapshot")) {
			return jsonResponse(200, { cursor: seq, entities: [...oplog] });
		}
		if (url.includes("/domain/delta")) {
			const since = Number(new URL(url).searchParams.get("since") ?? "0");
			return jsonResponse(200, { cursor: seq, entities: oplog.filter((e) => e.seq > since) });
		}
		if (method === "POST" && url.includes("/domain/mutate")) {
			const body = JSON.parse(String(init?.body)) as { mutations: Array<{ id: string; data: unknown }> };
			for (const m of body.mutations) oplog.push({ id: m.id, kind: "novel_mutation", seq: ++seq, data: m.data });
			return jsonResponse(200, { results: [], seq });
		}
		return jsonResponse(404, {});
	};
	const make = (sessionTag: string) =>
		new RemoteNovelStore({
			url: "http://srv",
			projectId: "prj_1",
			sessionTag,
			getAccessToken: async () => "jwt",
			getLeaseToken: () => "lease-1",
			getConversationId: () => "conv-1",
			fetchImpl,
		});
	return { make, requests, oplog };
}

describe("RemoteNovelStore", () => {
	it("mutate → 本地应用 + oplog 上行；query → snapshot/delta 重放后本地应答", async () => {
		const h = makeHarness();
		const a = h.make("session-a");
		const result = await a.mutate({
			op: "character.create",
			id: "char-1",
			input: { name: "沈砚" },
		});
		expect(result.entity).toBe("character");
		// query 走投影（先 snapshot——本会话条目跳过但 cursor 推进）
		const list = (await a.query({ op: "characters.list" })) as Array<{ name: string }>;
		expect(list[0]?.name).toBe("沈砚");
	});

	it("跨端收敛：A 会话写 → B 会话 delta 重放可见；B 再写 → A 可见", async () => {
		const h = makeHarness();
		const a = h.make("session-a");
		const b = h.make("session-b");
		await a.mutate({ op: "character.create", id: "char-1", input: { name: "沈砚" } });
		const bList = (await b.query({ op: "characters.list" })) as Array<{ name: string }>;
		expect(bList.map((c) => c.name)).toEqual(["沈砚"]);
		await b.mutate({ op: "character.create", id: "char-2", input: { name: "长街" } });
		const aList = (await a.query({ op: "characters.list" })) as Array<{ name: string }>;
		expect(aList.map((c) => c.name).sort()).toEqual(["沈砚", "长街"]);
		// 乐观锁语义保留：投影引擎对 stale baseRevision 抛错
		await expect(
			a.mutate({ op: "character.update", characterId: "char-1", baseRevision: 99, patch: { name: "x" } }),
		).rejects.toThrow();
	});

	it("mutateBatch 批量本地应用 + 单次上行", async () => {
		const h = makeHarness();
		const a = h.make("session-batch");
		const results = await a.mutateBatch([
			{ op: "character.create", id: "c1", input: { name: "一" } },
			{ op: "character.create", id: "c2", input: { name: "二" } },
		]);
		expect(results).toHaveLength(2);
		const posts = h.requests.filter((r) => r.startsWith("POST"));
		expect(posts).toHaveLength(1);
	});

	it("上推失败：抛错不吞（server 权威不缺记）", async () => {
		const h = makeHarness();
		const failing = new RemoteNovelStore({
			url: "http://srv",
			projectId: "prj_1",
			sessionTag: "s",
			getAccessToken: async () => "jwt",
			getLeaseToken: () => "lease",
			getConversationId: () => "conv",
			fetchImpl: async () => jsonResponse(410, { code: "lease_expired", message: "租约已失效" }),
		});
		await expect(failing.mutate({ op: "character.create", id: "c", input: { name: "x" } })).rejects.toThrow("租约已失效");
	});

	it("重放失败跳过（前向兼容钩子触发）", async () => {
		const skips: unknown[] = [];
		const store = new RemoteNovelStore({
			url: "http://srv",
			projectId: "p",
			sessionTag: "s2",
			getAccessToken: async () => "t",
			getLeaseToken: () => "l",
			getConversationId: () => "c",
			onReplaySkip: (_m, cause) => skips.push(cause),
			fetchImpl: async (url: string) =>
				jsonResponse(200, url.includes("/delta?") ? { cursor: 1, entities: [] } : {
					cursor: 1,
					entities: [
						// 非法 mutation（缺 input）→ 重放抛错 → 跳过
						{ id: "m1", kind: "novel_mutation", seq: 1, data: { sessionTag: "other", mutation: { op: "character.create", id: "x" } as never } },
					],
				}),
		});
		await store.query({ op: "characters.list" });
		expect(skips).toHaveLength(1);
	});
});
