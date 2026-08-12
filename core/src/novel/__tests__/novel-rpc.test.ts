import { describe, expect, it } from "vitest";
import { createMemoryTransportPair } from "../../rpc/transport.js";
import { NovelDbServer } from "../server/NovelDbServer.js";
import { NovelHandle } from "../client/NovelHandle.js";
import { EventPublisher } from "../../event/EventPublisher.js";
import { EventSubscriber } from "../../event/EventSubscriber.js";
import { NOVEL_CHANGED } from "../../event/topics.js";
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
			throw new Error("unhandled mutation: " + m.op);
		},
	};
}

/** 建内存传输 RPC + inproc ZeroMQ publisher（每测试唯一地址） */
async function setup(address: string) {
	const [clientT, serverT] = createMemoryTransportPair();
	const pub = new EventPublisher(address);
	await pub.bind();
	const server = new NovelDbServer(createMemoryStore(), pub);
	await server.start(serverT);
	const handle = new NovelHandle(clientT);
	return { server, handle };
}

describe("novel-db 垂直切片（RPC query/mutate + ZeroMQ 事件）", () => {
	it("query 经 RPC 往返", async () => {
		const { handle } = await setup("inproc://nr-1");
		const overview = await handle.query<{ novelId: string }>({ op: "overview.get" });
		expect(overview.novelId).toBe("n1");
	});

	it("远程查询错误 → RPCError(remote)", async () => {
		const { handle } = await setup("inproc://nr-2");
		await expect(handle.query({ op: "publication.get" })).rejects.toMatchObject({
			name: "RPCError",
			code: "remote",
		});
	});

	it("mutate 经 RPC 成功 → ZeroMQ 广播 novel.changed", async () => {
		const { handle } = await setup("inproc://nr-3");
		const sub = new EventSubscriber("inproc://nr-3", [NOVEL_CHANGED]);
		await sub.connect();
		await new Promise((r) => setTimeout(r, 30)); // slow joiner

		const recv = (async () => {
			for await (const e of sub) return e;
		})();

		const result = await handle.mutate({ op: "character.create", input: { name: "主角" } });
		expect(result.entity).toBe("character");
		expect(result.version).toBe(1);

		const evt = (await recv).payload as NovelChangeEvent;
		expect(evt.op).toBe("character.create");
		expect(evt.entity).toBe("character");
		expect(evt.id).toBe("c-1");
		expect(evt.version).toBe(1);
	});
});
