/**
 * LeaseClient / ServerApprovalChannel 单元测试（FR4/FR5）：
 * - 租约：acquire 形态 / 409 他端持有 LeaseHeldError（附 holderDeviceId）/ 410 LeaseLostError / release 幂等静默；
 * - 审批通道：submit POST 形态（含 leaseToken）/ resolve 幂等 409 容忍 / list 解析。
 */
import { describe, expect, it } from "vitest";
import { LeaseClient, LeaseHeldError, LeaseLostError } from "../server/LeaseClient.js";
import { ServerApprovalChannel } from "../server/ServerApprovalChannel.js";

type Req = { method: string; url: string; body: any };

function makeFetch(responder: (req: Req) => { status: number; body?: unknown } | "throw-network") {
	const requests: Req[] = [];
	const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
		const req: Req = {
			method: init?.method ?? "GET",
			url,
			body: init?.body !== undefined ? JSON.parse(String(init.body)) : undefined,
		};
		requests.push(req);
		const result = responder(req);
		if (result === "throw-network") throw new Error("down");
		return new Response(JSON.stringify(result.body ?? {}), { status: result.status, headers: { "content-type": "application/json" } });
	};
	return { requests, fetchImpl };
}

describe("LeaseClient", () => {
	it("acquire：POST /v1/leases，返回 token", async () => {
		const { requests, fetchImpl } = makeFetch(() => ({ status: 200, body: { leaseToken: "lt-1", expiresAt: 1 } }));
		const client = new LeaseClient({ url: "http://srv", conversationId: "c1", getAccessToken: async () => "tk", fetchImpl });
		const lease = await client.acquire();
		expect(lease.leaseToken).toBe("lt-1");
		expect(requests[0]!.url).toBe("http://srv/v1/leases");
		expect(requests[0]!.body).toEqual({ conversationId: "c1" });
	});

	it("409 他端持有 → LeaseHeldError（holderDeviceId）", async () => {
		const { fetchImpl } = makeFetch(() => ({ status: 409, body: { code: "lease_held", holderDeviceId: "dev-phone", expiresAt: 99 } }));
		const client = new LeaseClient({ url: "http://srv", conversationId: "c1", getAccessToken: async () => "tk", fetchImpl });
		await expect(client.acquire()).rejects.toBeInstanceOf(LeaseHeldError);
		await expect(client.acquire()).rejects.toMatchObject({ holderDeviceId: "dev-phone" });
	});

	it("heartbeat：410 → LeaseLostError；网络失败容忍不抛", async () => {
		let call = 0;
		const { fetchImpl } = makeFetch(() => {
			call += 1;
			return call === 1 ? { status: 410, body: { code: "lease_expired" } } : "throw-network";
		});
		const failures: unknown[] = [];
		const client = new LeaseClient({
			url: "http://srv", conversationId: "c1", getAccessToken: async () => "tk", fetchImpl,
			onHeartbeatFailure: (e) => failures.push(e),
		});
		await expect(client.heartbeat("lt")).rejects.toBeInstanceOf(LeaseLostError);
		await expect(client.heartbeat("lt")).resolves.toBeUndefined(); // 网络错容忍
		expect(failures).toHaveLength(2);
	});

	it("release：DELETE + 失败静默", async () => {
		const { requests, fetchImpl } = makeFetch(() => "throw-network");
		const client = new LeaseClient({ url: "http://srv", conversationId: "c1", getAccessToken: async () => "tk", fetchImpl });
		await expect(client.release("lt")).resolves.toBeUndefined();
		expect(requests.map((r) => r.method)).toEqual(["DELETE"]);
	});
});

describe("ServerApprovalChannel", () => {
	it("submit：POST /v1/approvals 带 leaseToken；失败静默", async () => {
		const { requests, fetchImpl } = makeFetch(() => ({ status: 201, body: { requestId: "r1", status: "pending" } }));
		const channel = new ServerApprovalChannel({
			url: "http://srv",
			getAccessToken: async () => "tk",
			getLeaseToken: (conversationId) => (conversationId === "c1" ? "lt-1" : undefined),
			fetchImpl,
		});
		await channel.submit({ conversationId: "c1", requestId: "r1", runSeq: 2, calls: [{ name: "write_file" }] });
		expect(requests[0]!.body).toMatchObject({ conversationId: "c1", requestId: "r1", runSeq: 2, leaseToken: "lt-1" });
	});

	it("resolve：200 与 409（already_decided）及网络失败均静默（懒过期兜底）", async () => {
		let mode: "ok" | "conflict" | "net" = "ok";
		const { fetchImpl } = makeFetch(() => (mode === "net" ? "throw-network" : { status: mode === "ok" ? 200 : 409, body: {} }));
		const channel = new ServerApprovalChannel({ url: "http://srv", getAccessToken: async () => "tk", getLeaseToken: () => "lt", fetchImpl });
		await expect(channel.resolve("r1", "approve")).resolves.toBeUndefined();
		mode = "conflict";
		await expect(channel.resolve("r1", "approve")).resolves.toBeUndefined();
		mode = "net";
		await expect(channel.resolve("r1", "approve")).resolves.toBeUndefined();
	});

	it("list：解析 approvals 行", async () => {
		const { fetchImpl } = makeFetch(() => ({ status: 200, body: { approvals: [{ id: 1, request_id: "r1", status: "pending" }] } }));
		const channel = new ServerApprovalChannel({ url: "http://srv", getAccessToken: async () => "tk", getLeaseToken: () => "lt", fetchImpl });
		const rows = await channel.list("c1");
		expect(rows).toHaveLength(1);
		expect(rows[0]!.request_id).toBe("r1");
	});
});
