import { describe, expect, it } from "vitest";
import { EventPublisher } from "../EventPublisher.js";
import { EventSubscriber } from "../EventSubscriber.js";
import { CONVERSATION_OUTPUT, NOVEL_CHANGED } from "../topics.js";

describe("EventPublisher / EventSubscriber（inproc）", () => {
	it("publish → subscriber 收到 { topic, payload }（JSON 解码）", async () => {
		const pub = new EventPublisher("inproc://evt-1");
		const sub = new EventSubscriber("inproc://evt-1", [NOVEL_CHANGED]);
		await pub.bind();
		await sub.connect();
		await new Promise((r) => setTimeout(r, 30)); // slow joiner 稳定

		const recv = (async () => {
			for await (const evt of sub) return evt;
		})();
		pub.publish(NOVEL_CHANGED, { op: "character.create", entity: "character" });

		const evt = await recv;
		expect(evt.topic).toBe(NOVEL_CHANGED);
		expect(evt.payload).toEqual({ op: "character.create", entity: "character" });
		await pub.close();
		await sub.close();
	});

	it("topic 前缀过滤：未订阅前缀收不到", async () => {
		const pub = new EventPublisher("inproc://evt-2");
		const sub = new EventSubscriber("inproc://evt-2", [NOVEL_CHANGED]);
		await pub.bind();
		await sub.connect();
		await new Promise((r) => setTimeout(r, 30));

		const recv = (async () => {
			for await (const evt of sub) return evt;
		})();
		pub.publish(CONVERSATION_OUTPUT, { type: "assistant.message" }); // 不匹配
		await new Promise((r) => setTimeout(r, 30));
		pub.publish(NOVEL_CHANGED, { op: "character.create" }); // 匹配

		const evt = await recv;
		expect(evt.topic).toBe(NOVEL_CHANGED); // 第一条收到的是匹配的
		await pub.close();
		await sub.close();
	});

	it("非 JSON payload 原样字符串", async () => {
		const pub = new EventPublisher("inproc://evt-3");
		const sub = new EventSubscriber("inproc://evt-3", [NOVEL_CHANGED]);
		await pub.bind();
		await sub.connect();
		await new Promise((r) => setTimeout(r, 30));

		const recv = (async () => {
			for await (const evt of sub) return evt;
		})();
		pub.publish(NOVEL_CHANGED, "raw-text");

		const evt = await recv;
		expect(evt.payload).toBe("raw-text");
		await pub.close();
		await sub.close();
	});
});
