import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventPublisher } from "../EventPublisher.js";
import { EventSubscriber } from "../EventSubscriber.js";
import { bindFocusChannel, requestFocus } from "../FocusChannel.js";
import { CONVERSATION_OUTPUT, NOVEL_CHANGED, conversationEventsAddr, novelEventsAddr } from "../topics.js";

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

describe("事件地址按实例唯一化", () => {
	it("novelEventsAddr 默认 = <tmpdir>/novel-events-<pid>；env 覆盖生效", () => {
		const saved = process.env.NOVEL_EVENTS_ADDR;
		try {
			delete process.env.NOVEL_EVENTS_ADDR;
			expect(novelEventsAddr()).toBe(`ipc://${join(tmpdir(), `novel-events-${process.pid}`)}`);
			process.env.NOVEL_EVENTS_ADDR = "inproc://debug-events";
			expect(novelEventsAddr()).toBe("inproc://debug-events");
		} finally {
			if (saved === undefined) delete process.env.NOVEL_EVENTS_ADDR;
			else process.env.NOVEL_EVENTS_ADDR = saved;
		}
	});

	it("conversationEventsAddr：无命名空间与有命名空间均落 tmpdir 且互不相同", () => {
		const saved = process.env.NOVEL_EVENT_NAMESPACE;
		try {
			delete process.env.NOVEL_EVENT_NAMESPACE;
			expect(conversationEventsAddr("conv_1")).toBe(
				`ipc://${join(tmpdir(), "novel-conv-conv_1-events")}`,
			);
			process.env.NOVEL_EVENT_NAMESPACE = "12345";
			expect(conversationEventsAddr("conv_1")).toBe(
				`ipc://${join(tmpdir(), "novel-conv-12345-conv_1-events")}`,
			);
		} finally {
			if (saved === undefined) delete process.env.NOVEL_EVENT_NAMESPACE;
			else process.env.NOVEL_EVENT_NAMESPACE = saved;
		}
	});
});

describe("FocusChannel（焦点回切，inproc）", () => {
	it("bind 监听 focus → 回调触发 + 挑战侧收 ack", async () => {
		const handle = await bindFocusChannel("inproc://focus-1", () => {});
		const focused = await requestFocus("inproc://focus-1", 2000);
		expect(focused).toBe(true);
		await handle.close();
	});

	it("无持有方（通道不通）→ 超时返回 false", async () => {
		const focused = await requestFocus("inproc://focus-2-unbound", 100);
		expect(focused).toBe(false);
	});

	it("多次 focus 请求均触发回调；close 后通道拆除", async () => {
		let count = 0;
		const handle = await bindFocusChannel("inproc://focus-3", () => {
			count++;
		});
		expect(await requestFocus("inproc://focus-3", 2000)).toBe(true);
		expect(await requestFocus("inproc://focus-3", 2000)).toBe(true);
		expect(count).toBe(2);
		await handle.close();
		expect(await requestFocus("inproc://focus-3", 100)).toBe(false);
	});
});
