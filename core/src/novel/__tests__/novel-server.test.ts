import { describe, expect, it } from "vitest";
import { NovelDbServer } from "../server/NovelDbServer.js";
import { EventPublisher } from "../../event/EventPublisher.js";
import { EventSubscriber } from "../../event/EventSubscriber.js";
import { NOVEL_CHANGED } from "../../event/topics.js";
import type { NovelStore } from "../store.js";
import type { NovelChangeEvent } from "../contract/event.js";
import type { NovelMutation } from "../contract/mutation.js";

/** 内存 store：版本递增，按 op 给实体类别 */
function createStore(): NovelStore {
	let v = 0;
	return {
		async query() {
			return {};
		},
		async mutate(m) {
			v++;
			const entity = m.op.startsWith("character") ? "character" : "outline";
			return { version: v, changeId: `x-${v}`, entity };
		},
	};
}

const mkUnit = (): NovelMutation => ({
	op: "outline.storyUnit.create",
	orderKey: "0000",
	title: "序章",
});
const mkChar = (): NovelMutation => ({ op: "character.create", input: { name: "主角" } });

/** 建 inproc publisher + subscriber + server（每测试唯一地址） */
async function setup(address: string) {
	const pub = new EventPublisher(address);
	await pub.bind();
	const sub = new EventSubscriber(address, [NOVEL_CHANGED]);
	await sub.connect();
	await new Promise((r) => setTimeout(r, 30)); // slow joiner 稳定
	const server = new NovelDbServer(createStore(), pub);
	return { server, sub };
}

describe("NovelDbServer：applyMutation → ZeroMQ novel.changed", () => {
	it("广播 well-formed novel.changed", async () => {
		const { server, sub } = await setup("inproc://ns-1");
		const recv = (async () => {
			for await (const evt of sub) return evt;
		})();

		await server.applyMutation(mkChar());
		const evt = (await recv).payload as NovelChangeEvent;

		expect(evt.type).toBe("novel.changed");
		expect(evt.op).toBe("character.create");
		expect(evt.entity).toBe("character");
		expect(evt.id).toBe("x-1");
		expect(evt.version).toBe(1);
	});

	it("多个订阅者都收到广播", async () => {
		const { server, sub } = await setup("inproc://ns-2");
		const subA = new EventSubscriber("inproc://ns-2", [NOVEL_CHANGED]);
		await subA.connect();
		await new Promise((r) => setTimeout(r, 30));

		const recvA = (async () => {
			for await (const e of subA) return e;
		})();
		const recvB = (async () => {
			for await (const e of sub) return e;
		})();

		await server.applyMutation(mkUnit());
		const a = (await recvA).payload as NovelChangeEvent;
		const b = (await recvB).payload as NovelChangeEvent;
		expect(a.op).toBe("outline.storyUnit.create");
		expect(b.op).toBe("outline.storyUnit.create");
		await subA.close();
	});

	it("按序投递，无丢失", async () => {
		const { server, sub } = await setup("inproc://ns-3");
		const received: NovelChangeEvent[] = [];
		const recv = (async () => {
			for await (const evt of sub) {
				received.push(evt.payload as NovelChangeEvent);
				if (received.length >= 3) break;
			}
		})();

		await server.applyMutation(mkUnit());
		await server.applyMutation(mkUnit());
		await server.applyMutation(mkUnit());
		await recv;

		expect(received.map((e) => e.version)).toEqual([1, 2, 3]);
	});
});
