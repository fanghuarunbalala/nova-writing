import { describe, expect, it } from "vitest";
import { createMemoryTransportPair } from "../../rpc/transport.js";
import { NovelDbServer } from "../server/NovelDbServer.js";
import { NovelHandle } from "../client/NovelHandle.js";
import type { NovelStore } from "../store.js";
import type { NovelChangeEvent } from "../contract/event.js";

/** 内存 NovelStore：角色增删 + overview */
function createMemoryStore(): NovelStore {
	let version = 0;
	const characters: Record<string, { name: string }> = {};
	return {
		async query(q) {
			switch (q.op) {
				case "overview.get":
					return {
						novelId: "n1",
						title: "测试小说",
						counts: {
							storyUnits: 0,
							characters: Object.keys(characters).length,
							locations: 0,
							paragraphs: 0,
						},
					};
				case "characters.list":
					return Object.values(characters);
				default:
					throw new Error("unhandled query: " + q.op);
			}
		},
		async mutate(m) {
			version++;
			if (m.op === "character.create") {
				const id = `c-${version}`;
				characters[id] = { name: m.input.name };
				return { version, changeId: id, entity: "character" };
			}
			if (m.op === "character.delete") {
				delete characters[m.characterId];
				return { version, changeId: m.characterId, entity: "character" };
			}
			throw new Error("unhandled mutation: " + m.op);
		},
	};
}

describe("novel-db 垂直切片（内存传输）", () => {
	it("NovelHandle.query 经 RPC 打到 NovelDbServer", async () => {
		const [clientT, serverT] = createMemoryTransportPair();
		const server = new NovelDbServer(createMemoryStore());
		await server.start(serverT);
		const handle = new NovelHandle(clientT);

		const overview = await handle.query<{ novelId: string }>({ op: "overview.get" });
		expect(overview.novelId).toBe("n1");

		const list = await handle.query<{ name: string }[]>({ op: "characters.list" });
		expect(list).toEqual([]);
	});

	it("mutate 成功并广播 novel.changed", async () => {
		const [clientT, serverT] = createMemoryTransportPair();
		const server = new NovelDbServer(createMemoryStore());
		await server.start(serverT);
		const handle = new NovelHandle(clientT);

		const received: NovelChangeEvent[] = [];
		const subId = await handle.subscribeChanges((evt) => received.push(evt));
		// 等 callback 注册送达，避免事件在订阅前到达
		await new Promise((r) => setTimeout(r, 30));

		const result = await handle.mutate({ op: "character.create", input: { name: "主角" } });
		expect(result.entity).toBe("character");
		expect(result.version).toBe(1);

		// 等 callback 推送送达
		await new Promise((r) => setTimeout(r, 30));
		expect(received).toHaveLength(1);
		expect(received[0].op).toBe("character.create");
		expect(received[0].entity).toBe("character");
		expect(received[0].id).toBe("c-1");
		expect(received[0].version).toBe(1);

		await handle.unsubscribeChanges(subId);
	});

	it("远程查询错误 → RPCError(remote)", async () => {
		const [clientT, serverT] = createMemoryTransportPair();
		const server = new NovelDbServer(createMemoryStore());
		await server.start(serverT);
		const handle = new NovelHandle(clientT);

		await expect(handle.query({ op: "publication.get" })).rejects.toMatchObject({
			name: "RPCError",
			code: "remote",
		});
	});
});
