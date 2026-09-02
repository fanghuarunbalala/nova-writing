/**
 * NovelDbWsServer 测试：kkrpc/ws 承载 novel query/mutate 请求-响应（token 经 subprotocol）。
 * 覆盖：正常往返、mutate 乐观锁 stale 错误传播、错误 token 拒绝握手。
 */
import { describe, expect, it, afterEach } from "vitest";
import { webSocketClientTransport } from "kkrpc/ws";
import { InMemoryNovelStore } from "../../InMemoryNovelStore.js";
import { NovelHandle } from "../../client/NovelHandle.js";
import {
	startNovelDbWsServer,
	type NovelDbWsServerHandle,
} from "../NovelDbWsServer.js";

const openServers: NovelDbWsServerHandle[] = [];

afterEach(async () => {
	await Promise.all(openServers.splice(0).map((s) => s.close()));
});

/** 起一个随机端口服务并记录（afterEach 统一关闭） */
async function makeServer(
	store = new InMemoryNovelStore(),
): Promise<NovelDbWsServerHandle> {
	const server = await startNovelDbWsServer({ store });
	openServers.push(server);
	return server;
}

describe("NovelDbWsServer（kkrpc/ws）", () => {
	it("query/mutate 经 WS 往返（token subprotocol 校验通过）", async () => {
		const server = await makeServer();
		const transport = webSocketClientTransport({ url: server.url, protocols: [server.token] });
		const handle = new NovelHandle(transport);

		const overview = await handle.query({ op: "overview.get" });
		expect((overview as { counts: { characters: number } }).counts.characters).toBe(0);

		await handle.mutate({ op: "character.create", input: { name: "苏眉" } });
		const characters = await handle.query({ op: "characters.list" });
		expect((characters as { name: string }[]).map((c) => c.name)).toEqual(["苏眉"]);

		handle.dispose();
	});

	it("mutate 乐观锁 stale 经 WS 传播并归一为 RPCError code=stale", async () => {
		const server = await makeServer();
		const transport = webSocketClientTransport({ url: server.url, protocols: [server.token] });
		const handle = new NovelHandle(transport);

		const created = await handle.mutate({
			op: "character.create",
			input: { name: "苏眉" },
		});
		await expect(
			handle.mutate({
				op: "character.update",
				characterId: created.changeId,
				baseRevision: created.version + 99, // 故意过期
				patch: { name: "苏眉改" },
			}),
		).rejects.toMatchObject({
			name: "RPCError",
			code: "stale",
		});

		handle.dispose();
	});

	it("错误 token 拒绝握手（连接失败）", async () => {
		const server = await makeServer();
		const transport = webSocketClientTransport({ url: server.url, protocols: ["wrong-token"] });
		const handle = new NovelHandle(transport);
		await expect(handle.query({ op: "overview.get" })).rejects.toThrow();
		handle.dispose();
	});
});
