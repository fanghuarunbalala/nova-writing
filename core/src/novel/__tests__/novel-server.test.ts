import { describe, expect, it } from "vitest";
import { NovelDbServer } from "../server/NovelDbServer.js";
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

describe("NovelDbServer 单元（无 RPC）", () => {
	it("applyMutation 广播 well-formed novel.changed", async () => {
		const server = new NovelDbServer(createStore());
		const received: NovelChangeEvent[] = [];
		await server.subscribe((evt) => received.push(evt));

		await server.applyMutation(mkChar());

		expect(received).toHaveLength(1);
		expect(received[0].type).toBe("novel.changed");
		expect(received[0].op).toBe("character.create");
		expect(received[0].entity).toBe("character");
		expect(received[0].id).toBe("x-1");
		expect(received[0].version).toBe(1);
	});

	it("多个订阅者都收到广播", async () => {
		const server = new NovelDbServer(createStore());
		const a: NovelChangeEvent[] = [];
		const b: NovelChangeEvent[] = [];
		await server.subscribe((e) => a.push(e));
		await server.subscribe((e) => b.push(e));

		await server.applyMutation(mkUnit());

		expect(a).toHaveLength(1);
		expect(b).toHaveLength(1);
		expect(a[0].op).toBe("outline.storyUnit.create");
	});

	it("事件按序投递，无丢失", async () => {
		const server = new NovelDbServer(createStore());
		const received: NovelChangeEvent[] = [];
		await server.subscribe((e) => received.push(e));

		await server.applyMutation(mkUnit());
		await server.applyMutation(mkUnit());
		await server.applyMutation(mkUnit());

		expect(received).toHaveLength(3);
		expect(received.map((e) => e.version)).toEqual([1, 2, 3]);
	});

	it("unsubscribe 后不再收到事件", async () => {
		const server = new NovelDbServer(createStore());
		const received: NovelChangeEvent[] = [];
		const id = await server.subscribe((e) => received.push(e));

		await server.applyMutation(mkUnit());
		expect(received).toHaveLength(1);

		await server.unsubscribe(id);
		await server.applyMutation(mkUnit());
		expect(received).toHaveLength(1);
	});
});
