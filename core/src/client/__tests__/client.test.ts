import { describe, expect, it, afterAll } from "vitest";
import { expose, wrap } from "kkrpc";
import { createMemoryTransportPair } from "../../rpc/transport.js";
import { Conversation } from "../../conversation/server/Conversation.js";
import {
	ConversationManagerServer,
	type ConversationFactory,
} from "../../conversation/server/ConversationManagerServer.js";
import { InMemoryNovelStore } from "../../novel/InMemoryNovelStore.js";
import { NovelDbServer } from "../../novel/server/NovelDbServer.js";
import { EventPublisher } from "../../event/EventPublisher.js";
import { ConversationManagerHandle } from "../../manager/ConversationManagerHandle.js";
import { NovelHandle } from "../../novel/client/NovelHandle.js";
import { createNovelApiClient, createNovelApiServer } from "../NovelApiClient.js";
import { ConversationProjection } from "../ConversationProjection.js";
import type { AgentLoop } from "../../runtime/loop/AgentLoop.js";
import type { TurnContext } from "../../runtime/loop/types.js";
import type { OutputEvent } from "../../conversation/contract/events/index.js";
import type { ConversationHandle } from "../../conversation/contract/handle/index.js";

/** 模拟 AgentLoop（只触发事件，不发真实 provider 调用） */
function mockLoop(): AgentLoop {
	const listeners = new Set<(e: OutputEvent) => void>();
	let seq = 0;
	return {
		run: async () => ({ final: { role: "assistant" as const, content: "ok" }, usage: undefined }),
		followup: () => {
			seq += 1;
			return {
				seq,
				messages: [{ role: "user", content: "" }],
				ts: "t",
				appendTurnMessages: () => {},
			} as TurnContext;
		},
		steer: () => {},
		stop: () => {},
		cancel: () => {},
		onOutputEvent: (l: (e: OutputEvent) => void) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
	} as unknown as AgentLoop;
}

/** 内存 Conversation 工厂 */
function conversationFactory(): ConversationFactory {
	return {
		create: (o) =>
			new Conversation({
				conversationId: o.conversationId,
				loop: mockLoop(),
				sampling: { model: "gpt-5" },
			}),
	};
}

/** 构造假的 ConversationHandle（subscribeEvents 同步回放给定事件序列） */
function fakeHandle(events: OutputEvent[]): ConversationHandle {
	return {
		sendUserMessage: async () => ({ seq: 0, recordedAt: "" }),
		sendUserCommand: async () => ({ seq: 0, recordedAt: "" }),
		sendSystemControl: async () => ({ seq: 0, recordedAt: "" }),
		sendApprovalRequest: async () => ({ kind: "approve" }),
		sendAskingQuestionRequest: async () => "",
		sendExitComposeRequest: async () => {},
		subscribeEvents: async (listener) => {
			for (const e of events) listener(e);
		},
		dispose: () => {},
	};
}

/** 构造一条 OutputEvent（缺省 conversationId/ts） */
function evt(e: Partial<OutputEvent> & { type: OutputEvent["type"] }): OutputEvent {
	return { conversationId: "c1", ts: "t", ...e } as OutputEvent;
}

describe("ConversationProjection（精简投影）", () => {
	it("user.message → assistant.delta×N → turn-end 收口成 timeline", async () => {
		const handle = fakeHandle([
			evt({ type: "user.message", persist: true, seq: 1, text: "你好" }),
			evt({ type: "assistant.delta", text: "你好" }),
			evt({ type: "assistant.delta", text: "，世界" }),
			evt({ type: "turn-end", persist: true, seq: 2, turnSeq: 1 }),
		]);
		const projection = new ConversationProjection(handle, "c1");
		await projection.start();
		await projection.stop();

		const timeline = projection.getSnapshot().timeline;
		expect(timeline).toHaveLength(2);
		expect(timeline[0]).toMatchObject({ kind: "user", text: "你好" });
		expect(timeline[1]).toMatchObject({ kind: "assistant", text: "你好，世界", streaming: false });
		expect(projection.getSnapshot().lastAppliedSequence).toBe(2);
	});

	it("订阅者收到快照发布", async () => {
		const handle = fakeHandle([evt({ type: "user.message", persist: true, seq: 1, text: "hi" })]);
		const projection = new ConversationProjection(handle, "c1");
		let published = 0;
		projection.subscribe(() => {
			published += 1;
		});
		await projection.start();
		await projection.stop();
		expect(published).toBeGreaterThan(0);
	});
});

describe("createNovelApiClient（门面）", () => {
	const publisher = new EventPublisher("inproc://client-test-events");

	afterAll(async () => {
		await publisher.close();
	});

	it("novel 域 query/mutate 经内存传输往返", async () => {
		const store = new InMemoryNovelStore();
		await publisher.bind();
		const server = new NovelDbServer(store, publisher);
		const [clientT, serverT] = createMemoryTransportPair();
		await server.start(serverT);
		const novelHandle = new NovelHandle(clientT);

		const facade = createNovelApiClient({ manager: stubManagerHandle(), novel: novelHandle });

		const overview = await facade.novel.overview.get();
		expect(overview.counts.characters).toBe(0);

		await facade.novel.mutate({ op: "character.create", input: { name: "张三" } });
		const characters = await facade.novel.characters.list();
		expect(characters).toHaveLength(1);
		expect(characters[0].name).toBe("张三");
	});

	it("conversations 目录 list/delete + open 返回可用 handle 经内存传输往返", async () => {
		const [clientT, serverT] = createMemoryTransportPair();
		const server = new ConversationManagerServer(conversationFactory());
		expose(server, serverT);
		const managerHandle = new ConversationManagerHandle(clientT);

		// createOrResume 填充目录 + 返回 remote ref handle（kkrpc 自动注册跨传输可调）
		const ref = await managerHandle.createOrResume("c1");
		expect(ref.conversationId).toBe("c1");
		// 返回的 handle 是远端引用：sendSystemControl 可跨传输调用
		const receipt = await ref.handle.sendSystemControl({ type: "mode.set", mode: "bypass" });
		expect(receipt).toMatchObject({ seq: 0 });

		const list = await managerHandle.list();
		expect(list).toHaveLength(1);
		expect(list[0].conversationId).toBe("c1");

		await managerHandle.delete("c1");
		expect(await managerHandle.list()).toHaveLength(0);
	});

	it("facade.conversations.open 返回可用 handle", async () => {
		const [clientT, serverT] = createMemoryTransportPair();
		const server = new ConversationManagerServer(conversationFactory());
		expose(server, serverT);
		const facade = createNovelApiClient({
			manager: new ConversationManagerHandle(clientT),
			novel: stubNovelHandle(),
		});

		const handle = await facade.conversations.open("c2");
		const receipt = await handle.sendUserMessage({ text: "hi" });
		expect(receipt).toMatchObject({ seq: 1 });
		handle.dispose();
	});

	it("createNovelApiServer ↔ wrap 全程往返（服务端门面直连）", async () => {
		const store = new InMemoryNovelStore();
		const managerServer = new ConversationManagerServer(conversationFactory());
		const serverApi = createNovelApiServer({ manager: managerServer, novel: store });

		const [clientT, serverT] = createMemoryTransportPair();
		expose(serverApi, serverT);
		const api = wrap<ReturnType<typeof createNovelApiServer>>(clientT);

		// conversations 域
		const created = await api.conversations.create();
		const list = await api.conversations.list();
		expect(list).toHaveLength(1);
		expect(list[0].conversationId).toBe(created.conversationId);
		const opened = await api.conversations.open(created.conversationId);
		expect((await opened.sendUserMessage({ text: "hi" })).seq).toBe(1);
		await api.conversations.delete(created.conversationId);

		// novel 域
		await api.novel.mutate({ op: "location.create", input: { name: "长安" } });
		const locations = await api.novel.locations.list();
		expect(locations).toHaveLength(1);
		expect(locations[0].name).toBe("长安");
	});
});

/** 占位 manager handle（novel 测试里不用 conversations 域） */
function stubManagerHandle(): ConversationManagerHandle {
	return {
		list: async () => [],
		createOrResume: async () => {
			throw new Error("stub");
		},
		spawnConversation: async () => {
			throw new Error("stub");
		},
		delete: async () => {},
		sendMessageTo: async () => ({ seq: 0, recordedAt: "" }),
		dispose: () => {},
	} as unknown as ConversationManagerHandle;
}

/** 占位 novel handle（conversations 测试里不用 novel 域） */
function stubNovelHandle(): NovelHandle {
	return {
		query: async () => undefined,
		mutate: async () => ({ version: 1, changeId: "", entity: "outline" }),
		dispose: () => {},
	} as unknown as NovelHandle;
}
