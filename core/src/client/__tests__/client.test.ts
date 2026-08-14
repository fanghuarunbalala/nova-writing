import { describe, expect, it, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { expose, wrap } from "kkrpc";
import { createMemoryTransportPair } from "../../rpc/transport.js";
import { Conversation } from "../../conversation/server/Conversation.js";
import { FileConversationJournalService } from "../../conversation/persistence/FileConversationJournalService.js";
import {
	ConversationManagerServer,
	type ConversationFactory,
	type ConversationProcessSpawner,
} from "../../conversation/server/ConversationManagerServer.js";
import { InMemoryNovelStore } from "../../novel/InMemoryNovelStore.js";
import { NovelDbServer } from "../../novel/server/NovelDbServer.js";
import { EventPublisher } from "../../event/EventPublisher.js";
import { ConversationManagerHandle } from "../../manager/ConversationManagerHandle.js";
import { NovelHandle } from "../../novel/client/NovelHandle.js";
import { createNovelApiClient, createNovelApiServer } from "../NovelApiClient.js";
import { ConversationProjection } from "../ConversationProjection.js";
import type { AgentLoop } from "../../runtime/loop/AgentLoop.js";
import type { RunContext } from "../../runtime/loop/types.js";
import type { ProjectedEvent } from "../../conversation/contract/events/index.js";
import type { ConversationHandle } from "../../conversation/contract/handle/index.js";

/** 模拟 AgentLoop（只触发事件，不发真实 provider 调用） */
function mockLoop(): AgentLoop {
	const listeners = new Set<(e: ProjectedEvent) => void>();
	let seq = 0;
	return {
		run: async () => ({ final: { role: "assistant" as const, content: "ok" }, usage: undefined }),
		followup: () => {
			seq += 1;
			return {
				seq,
				messages: [{ role: "user", content: "" }],
				ts: "t",
				appendRunMessages: () => {},
			} as RunContext;
		},
		steer: () => {},
		stop: () => {},
		cancel: () => {},
		onOutputEvent: (l: (e: ProjectedEvent) => void) => {
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
function fakeHandle(events: ProjectedEvent[]): ConversationHandle {
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
		resolveApproval: () => {},
		resolveQuestion: () => {},
		resolveExitCompose: () => {},
		getConversationMode: async () => "review",
		dispose: () => {},
	};
}

/** 构造一条 OutputEvent（缺省 conversationId/ts） */
function evt(e: Partial<ProjectedEvent> & { type: ProjectedEvent["type"] }): ProjectedEvent {
	return { conversationId: "c1", ts: "t", ...e } as ProjectedEvent;
}

describe("ConversationProjection（精简投影）", () => {
	it("user.message → assistant.delta×N → run-end 收口成 timeline", async () => {
		const handle = fakeHandle([
			evt({ type: "user.message", persist: true, seq: 1, text: "你好" }),
			evt({ type: "assistant.delta", text: "你好" }),
			evt({ type: "assistant.delta", text: "，世界" }),
			evt({ type: "run-end", persist: true, seq: 2, runSeq: 1 }),
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

describe("ConversationProjection（恢复重放）", () => {
	it("先订阅缓冲 → history 应用 → 冲刷（历史已覆盖去重 + delta live-turn 门控，无丢失/重复）", async () => {
		// 订阅先行：start 挂在 history promise 上，期间事件进缓冲
		let listener: ((e: ProjectedEvent) => void) | undefined;
		const handle: ConversationHandle = {
			...fakeHandle([]),
			subscribeEvents: async (l: (e: ProjectedEvent) => void) => {
				listener = l;
			},
		};
		let resolveHistory!: (events: ProjectedEvent[]) => void;
		const historyPromise = new Promise<ProjectedEvent[]>((r) => {
			resolveHistory = r;
		});
		const historyEvents: ProjectedEvent[] = [
			evt({ type: "run-start", persist: true, seq: 1, runSeq: 1 }),
			evt({ type: "user.message", persist: true, seq: 1, text: "历史问题" }),
			evt({ type: "assistant.message", persist: true, seq: 1, text: "历史回复" }),
			evt({ type: "run-end", persist: true, seq: 1, runSeq: 1 }),
		];
		const projection = new ConversationProjection(handle, "c1", () => historyPromise);
		const startPromise = projection.start();
		// 等 start 进入 history 阶段后向缓冲推事件（订阅与重放间隙）
		await new Promise((r) => setTimeout(r, 0));
		listener?.(evt({ type: "run-start", persist: true, seq: 1, runSeq: 1 })); // 已被历史覆盖 → 丢弃
		listener?.(evt({ type: "assistant.delta", text: "尾流" })); // live turn 未开 → 丢弃
		listener?.(evt({ type: "run-start", persist: true, seq: 2, runSeq: 2 })); // 新 turn
		listener?.(evt({ type: "user.message", persist: true, seq: 2, text: "新问题" }));
		listener?.(evt({ type: "assistant.delta", text: "新" }));
		listener?.(evt({ type: "assistant.delta", text: "答" }));
		listener?.(evt({ type: "assistant.message", persist: true, seq: 2, text: "新答" })); // 替换活跃流式项
		listener?.(evt({ type: "run-end", persist: true, seq: 2, runSeq: 2 }));
		listener?.(evt({ type: "assistant.delta", text: "再尾" })); // turn 已收口 → 丢弃
		resolveHistory(historyEvents);
		await startPromise;

		const snapshot = projection.getSnapshot();
		expect(snapshot.timeline.map((t) => t.text)).toEqual(["历史问题", "历史回复", "新问题", "新答"]);
		expect(snapshot.timeline[3]).toMatchObject({ kind: "assistant", streaming: false });
		expect(snapshot.lastAppliedSequence).toBe(2);
	});

	it("replayed 之后实时事件直通", async () => {
		let listener: ((e: ProjectedEvent) => void) | undefined;
		const handle: ConversationHandle = {
			...fakeHandle([]),
			subscribeEvents: async (l: (e: ProjectedEvent) => void) => {
				listener = l;
			},
		};
		const projection = new ConversationProjection(handle, "c1", async () => []);
		await projection.start();
		listener?.(evt({ type: "user.message", persist: true, seq: 1, text: "直接" }));
		expect(projection.getSnapshot().timeline.map((t) => t.text)).toEqual(["直接"]);
	});

describe("ConversationProjection（liveState）", () => {
	function makeLiveProjection(): {
		projection: ConversationProjection;
		emit: (e: ProjectedEvent) => void;
	} {
		let listener: ((e: ProjectedEvent) => void) | undefined;
		const handle: ConversationHandle = {
			...fakeHandle([]),
			subscribeEvents: async (l: (e: ProjectedEvent) => void) => {
				listener = l;
			},
		};
		const projection = new ConversationProjection(handle, "c1", async () => []);
		return { projection, emit: (e) => listener?.(e) };
	}

	it("reasoning delta → 防御性忽略（loop 层已丢弃不发送）：不产生 liveState、timeline 无新项", async () => {
		const { projection, emit } = makeLiveProjection();
		await projection.start();
		emit(evt({ type: "assistant.delta", kind: "reasoning", text: "让我想想" }));
		expect(projection.getSnapshot().liveState).toBeUndefined();
		expect(projection.getSnapshot().timeline).toHaveLength(0);
	});

	it("text delta → liveState=generating + streaming 项仅含正文", async () => {
		const { projection, emit } = makeLiveProjection();
		await projection.start();
		emit(evt({ type: "assistant.delta", kind: "text", text: "正文" }));
		const snapshot = projection.getSnapshot();
		expect(snapshot.liveState).toBe("generating");
		expect(snapshot.timeline).toHaveLength(1);
		expect(snapshot.timeline[0]).toMatchObject({ text: "正文", streaming: true });
	});

	it("assistant.message / run-end 收口 → liveState 清除；正文不含思考文本", async () => {
		const { projection, emit } = makeLiveProjection();
		await projection.start();
		emit(evt({ type: "assistant.delta", kind: "text", text: "秋夜。" }));
		emit(evt({ type: "assistant.message", persist: true, seq: 1, text: "秋夜。" }));
		const snapshot = projection.getSnapshot();
		expect(snapshot.liveState).toBeUndefined();
		expect(snapshot.timeline.map((t) => t.text)).toEqual(["秋夜。"]);
	});

	it("tool-recorded 对按 turn 切段：每段 = 内容片段 + 单行工具（进行中→完成替换）", async () => {
		const { projection, emit } = makeLiveProjection();
		await projection.start();
		emit(evt({ type: "run-start", persist: true, seq: 1, runSeq: 1 }));
		emit(evt({ type: "user.message", persist: true, seq: 1, text: "写角色" }));
		emit(evt({ type: "assistant.delta", kind: "text", text: "好" }));
		emit(evt({ type: "tool-recorded.started", seq: 1, toolCallId: "t1", name: "CharacterWrite", preview: { action: "创建", object: "角色", title: "张三" }, ts: "2026-08-14T10:00:00.000Z" }));
		// 进行中：段 1 内已有 running 行（outcome 未定义）
		const running = projection.getSnapshot().timeline.find((i) => i.kind === "assistant");
		expect(running?.segments?.[0]).toMatchObject({
			text: "好",
			tools: [{ traceId: "t1", toolName: "CharacterWrite" }],
		});
		expect(running?.segments?.[0]?.tools[0]?.outcome).toBeUndefined();
		emit(evt({ type: "tool-recorded.recorded", seq: 1, toolCallId: "t1", name: "CharacterWrite", outcome: "ok", durationMs: 1500, preview: { action: "创建", object: "角色", title: "张三", summary: "角色已写入" }, ts: "2026-08-14T10:00:01.500Z" }));
		// 收口行替换 running 行（不追加重复）
		const done = projection.getSnapshot().timeline.find((i) => i.kind === "assistant");
		expect(done?.segments?.[0]?.tools).toHaveLength(1);
		expect(done?.segments?.[0]?.tools[0]).toMatchObject({
			traceId: "t1",
			toolName: "CharacterWrite",
			outcome: "ok",
			durationMs: 1500,
			preview: { action: "创建", object: "角色", title: "张三" },
		});
		// 完成工具行之后的新 delta → 开新段
		emit(evt({ type: "assistant.delta", kind: "text", text: "接着写正文" }));
		emit(evt({ type: "assistant.message", persist: true, seq: 1, text: "好的，接着写正文" }));
		emit(evt({ type: "run-end", persist: true, seq: 1, runSeq: 1 }));

		const snapshot = projection.getSnapshot();
		const assistant = snapshot.timeline.find((item) => item.kind === "assistant");
		expect(assistant).toMatchObject({ sourceSequence: 1, runEndSequence: 1, streaming: false });
		expect(assistant?.text).toBe("好的，接着写正文");
		expect(assistant?.segments).toHaveLength(2);
		expect(assistant?.segments?.[0]).toMatchObject({ text: "好" });
		expect(assistant?.segments?.[0]?.tools).toHaveLength(1);
		expect(assistant?.segments?.[1]).toMatchObject({ text: "接着写正文", tools: [] });
		// eventFlow 已随本轮时序删除
		expect(snapshot).not.toHaveProperty("eventFlow");
		expect(snapshot).not.toHaveProperty("toolTraces");
	});

	it("history 失败 → state=error 且 liveState 不残留", async () => {
		const handle: ConversationHandle = {
			...fakeHandle([]),
			subscribeEvents: async () => {},
		getConversationMode: async () => "review",
		};
		const projection = new ConversationProjection(handle, "c1", async () => {
			throw new Error("boom");
		});
		await projection.start();
		expect(projection.getSnapshot().state).toBe("error");
		expect(projection.getSnapshot().liveState).toBeUndefined();
	});
});

	it("resume 重放增量（fromSeq = lastAppliedSequence）", async () => {
		const historyCalls: Array<{ fromSeq?: number }> = [];
		let listener: ((e: ProjectedEvent) => void) | undefined;
		const handle: ConversationHandle = {
			...fakeHandle([]),
			subscribeEvents: async (l: (e: ProjectedEvent) => void) => {
				listener = l;
			},
		};
		const projection = new ConversationProjection(handle, "c1", async (opts) => {
			historyCalls.push(opts);
			if (opts.fromSeq === 1) return [];
			return [evt({ type: "user.message", persist: true, seq: 2, text: "增量" })];
		});
		await projection.start();
		expect(historyCalls[0]).toMatchObject({ fromSeq: 1 });
		listener?.(evt({ type: "user.message", persist: true, seq: 1, text: "首条" }));
		await projection.resume();
		expect(historyCalls[1]).toMatchObject({ fromSeq: 2 }); // lastAppliedSequence=1 → from 2
		expect(projection.getSnapshot().timeline.map((t) => t.text)).toEqual(["首条", "增量"]);
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

	it("函数型对端 handle（plain kkrpc wrap 形态）经适配后对象形态可属性转发", async () => {
		// plain kkrpc wrap 的代理以函数为目标（typeof === "function"），
		// 不经适配会被 remote-refs 编成 function-kind ref（属性访问丢失）
		const handleLike = Object.assign(function () {}, {
			sendUserMessage: async () => ({ seq: 1, recordedAt: "" }),
			sendUserCommand: async () => ({ seq: 0, recordedAt: "" }),
			sendSystemControl: async () => ({ seq: 0, recordedAt: "" }),
			sendApprovalRequest: async () => ({ kind: "approve" }),
			sendAskingQuestionRequest: async () => "",
			sendExitComposeRequest: async () => {},
			subscribeEvents: async () => {},
		getConversationMode: async () => "review",
			resolveApproval: () => {},
			resolveQuestion: () => {},
			resolveExitCompose: () => {},
			dispose: () => {},
		}) as unknown as ConversationHandle;
		const fakeSpawner: ConversationProcessSpawner = {
			spawn: () => ({
				child: new EventEmitter() as unknown as ChildProcess,
				handle: handleLike,
			}),
		};
		const server = new ConversationManagerServer(conversationFactory(), fakeSpawner);
		const api = createNovelApiServer({ manager: server, novel: new InMemoryNovelStore() });
		const created = await api.conversations.create();
		expect(typeof created.handle).toBe("object");
		expect(typeof created.handle.subscribeEvents).toBe("function");
		await expect(created.handle.sendUserMessage({ text: "hi" })).resolves.toMatchObject({ seq: 1 });
	});

	it("conversations.history 经 journalDir 代读（嵌套布局 journal 沙盒）", async () => {
		const dir = mkdtempSync(join(tmpdir(), "facade-jrnl-"));
		const journal = new FileConversationJournalService({
			conversationId: "c1",
			filePath: join(dir, "c1", "journal.jsonl"),
		});
		await journal.open();
		await journal.appendRun({
			seq: 1,
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "hello" },
			],
			ts: "t",
			appendRunMessages: () => {},
		});
		const serverApi = createNovelApiServer({
			manager: new ConversationManagerServer(conversationFactory()),
			novel: new InMemoryNovelStore(),
			journalDir: dir,
		});
		const events = await serverApi.conversations.history("c1", {});
		expect(events.map((e) => e.type)).toEqual([
			"run-start",
			"user.message",
			"assistant.message",
			"run-end",
		]);
		// 无 journalDir 时返回空序列
		const noJournalApi = createNovelApiServer({
			manager: new ConversationManagerServer(conversationFactory()),
			novel: new InMemoryNovelStore(),
		});
		expect(await noJournalApi.conversations.history("c1", {})).toEqual([]);
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
