/**
 * ServerEventBridge 单元测试（FR3）：
 * - SSE 帧解析（跨 chunk 缓冲 / 心跳注释行忽略 / [done] 哨兵）；
 * - since 游标自动推进（journal 事件 seq）+ 重连携带；
 * - 断线重连（退避后二连）与 stop 收口。
 */
import { describe, expect, it, vi } from "vitest";
import { ServerEventBridge, type ServerStreamEvent } from "../server/ServerEventBridge.js";

function sseResponse(frames: string[], chunkSize = 8): Response {
	const full = frames.join("");
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];
	for (let i = 0; i < full.length; i += chunkSize) {
		chunks.push(encoder.encode(full.slice(i, i + chunkSize)));
	}
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			controller.close();
		},
	});
	return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function frame(obj: unknown): string {
	return `data: ${JSON.stringify(obj)}\n\n`;
}

describe("ServerEventBridge", () => {
	it("帧解析：事件分发 + since 游标推进 + 心跳忽略", async () => {
		const events: ServerStreamEvent[] = [];
		const bridge = new ServerEventBridge({
			url: "http://srv",
			getAccessToken: async () => "tk",
			onEvent: (e) => events.push(e),
			fetchImpl: async () =>
				sseResponse([
					": heartbeat\n\n",
					frame({ type: "ready", backlog: 0 }),
					frame({ type: "journal", seq: 7, runSeq: 1, kind: "append" }),
					frame({ type: "journal", seq: 9, runSeq: 1, kind: "append" }),
				]),
		});
		bridge.start();
		await vi.waitFor(() => expect(events.length).toBe(3));
		await bridge.stop();
		expect(events.map((e) => e.type)).toEqual(["ready", "journal", "journal"]);
		expect(bridge.cursor).toBe(9);
	});

	it("重连：流结束后带最新 since 二连", async () => {
		const queryies: string[] = [];
		let connects = 0;
		const bridge = new ServerEventBridge({
			url: "http://srv",
			getAccessToken: async () => "tk",
			onEvent: () => {},
			fetchImpl: async (url) => {
				queryies.push(url);
				connects += 1;
				return connects === 1
					? sseResponse([frame({ type: "journal", seq: 3 })])
					: sseResponse([frame({ type: "journal", seq: 5 })]);
			},
		});
		bridge.start();
		await vi.waitFor(() => expect(connects).toBe(2), { timeout: 5000 });
		await bridge.stop();
		expect(bridge.cursor).toBe(5);
		expect(queryies[1]).toContain("since=3");
		expect(queryies[1]).toContain("access_token=tk");
	});

	it("conversationId 订阅：查询参数携带", async () => {
		const seen: string[] = [];
		const bridge = new ServerEventBridge({
			url: "http://srv",
			conversationId: "conv-9",
			getAccessToken: async () => "tk",
			onEvent: () => {},
			fetchImpl: async (url) => {
				seen.push(url);
				return new Response(null, { status: 500 }); // 立即失败走退避（stop 收口）
			},
		});
		bridge.start();
		await vi.waitFor(() => expect(seen.length).toBe(1));
		await bridge.stop();
		expect(seen[0]).toContain("conversationId=conv-9");
	});

	it("连接失败：退避重试且不抛出", async () => {
		let attempts = 0;
		const bridge = new ServerEventBridge({
			url: "http://srv",
			getAccessToken: async () => "tk",
			onEvent: () => {},
			fetchImpl: async () => {
				attempts += 1;
				throw new Error("down");
			},
		});
		bridge.start();
		await vi.waitFor(() => expect(attempts).toBeGreaterThanOrEqual(2), { timeout: 5000 });
		await bridge.stop();
	});
});
