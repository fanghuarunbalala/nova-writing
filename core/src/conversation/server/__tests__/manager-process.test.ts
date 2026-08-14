/**
 * ConversationManagerServer 进程模式生产路径测试：
 * storedir 分配/env 传递、崩溃监听、死后重派生、目录扫描恢复、主动终止删目录。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import {
	ConversationManagerServer,
	type ConversationFactory,
	type ConversationProcessSpawner,
} from "../ConversationManagerServer.js";
import type { Conversation } from "../Conversation.js";
import type { ConversationHandle } from "../../contract/handle/index.js";

/** 假子进程：EventEmitter + kill/exitCode，供 attachExit 与死亡检测 */
class FakeChild extends EventEmitter {
	exitCode: number | null = null;
	killed = false;

	/** 模拟 kill（真实 kill 为异步，exit 事件后置） */
	kill(): void {
		this.killed = true;
	}

	/** 模拟崩溃退出 */
	exitCrashed(): void {
		this.exitCode = 1;
		this.emit("exit");
	}

	/** 模拟主动终止后的退出 */
	exitTerminated(): void {
		this.exitCode = 0;
		this.emit("exit");
	}
}

interface SpawnRecord {
	opts: Parameters<ConversationProcessSpawner["spawn"]>[0];
	child: FakeChild;
}

/** 记录 spawn 调用的假派生器（与真实 ProcessSpawner 一致：spawn 前 mkdir storedir） */
function makeFakeSpawner(): { spawner: ConversationProcessSpawner; spawned: SpawnRecord[] } {
	const spawned: SpawnRecord[] = [];
	const spawner: ConversationProcessSpawner = {
		spawn(opts) {
			mkdirSync(opts.storedir, { recursive: true });
			const child = new FakeChild();
			spawned.push({ opts, child });
			return { child: child as unknown as ChildProcess, handle: fakeHandle() };
		},
	};
	return { spawner, spawned };
}

/** 进程模式不使用的工厂占位 */
function noopFactory(): ConversationFactory {
	return { create: () => ({}) as unknown as Conversation };
}

/** 最小 ConversationHandle 桩 */
function fakeHandle(): ConversationHandle {
	return {
		sendUserMessage: async () => ({ seq: 0, recordedAt: "" }),
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
	};
}

describe("ConversationManagerServer（进程模式生产路径）", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "novel-mgr-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("spawnConversation 分配 storedir 并传递（spawner 收到 storedir 且目录已建）", async () => {
		const { spawner, spawned } = makeFakeSpawner();
		const server = new ConversationManagerServer(noopFactory(), spawner, { storedirRoot: root });

		const ref = await server.spawnConversation({ agentType: "novel" });
		expect(spawned).toHaveLength(1);
		expect(spawned[0]!.opts.storedir).toBe(join(root, ref.conversationId));
		expect(existsSync(spawned[0]!.opts.storedir)).toBe(true);

		const list = await server.list();
		expect(list).toHaveLength(1);
		expect(list[0]!.storeDir).toBe(spawned[0]!.opts.storedir);
		expect(list[0]!.status).toBe("active");
	});

	it("子进程崩溃 → summary 置 crashed、handles 清理", async () => {
		const { spawner, spawned } = makeFakeSpawner();
		const server = new ConversationManagerServer(noopFactory(), spawner, { storedirRoot: root });

		const ref = await server.spawnConversation({ agentType: "novel" });
		spawned[0]!.child.exitCrashed();

		expect((await server.list())[0]!.status).toBe("crashed");
		// 崩溃后 createOrResume 重派生（而非复用僵尸 handle）
		const resumed = await server.createOrResume(ref.conversationId);
		expect(spawned).toHaveLength(2);
		expect(resumed.conversationId).toBe(ref.conversationId);
		expect(spawned[1]!.opts.storedir).toBe(spawned[0]!.opts.storedir);
		expect((await server.list())[0]!.status).toBe("active");
	});

	it("createOrResume 存活子进程直接复用（不重复 spawn）", async () => {
		const { spawner, spawned } = makeFakeSpawner();
		const server = new ConversationManagerServer(noopFactory(), spawner, { storedirRoot: root });

		const ref = await server.spawnConversation({ agentType: "novel" });
		await server.createOrResume(ref.conversationId);
		await server.createOrResume(ref.conversationId);
		expect(spawned).toHaveLength(1);
	});

	it("构造时扫描目录种子 catalog + seq 恢复（conv_3 之后新 id 从 conv_4 起；历史会话可重派生）", async () => {
		mkdirSync(join(root, "conv_1"), { recursive: true });
		mkdirSync(join(root, "conv_3"), { recursive: true });
		const { spawner, spawned } = makeFakeSpawner();
		const server = new ConversationManagerServer(noopFactory(), spawner, { storedirRoot: root });

		const list = await server.list();
		expect(list.map((s) => s.conversationId).sort()).toEqual(["conv_1", "conv_3"]);
		expect(list.every((s) => s.status === "stopped")).toBe(true);
		expect(list.every((s) => s.storeDir !== "")).toBe(true);

		const ref = await server.spawnConversation({ agentType: "novel" });
		expect(ref.conversationId).toBe("conv_4");

		// 打开扫描出的历史会话：同 storedir 重派生
		const resumed = await server.createOrResume("conv_1");
		expect(resumed.conversationId).toBe("conv_1");
		expect(spawned).toHaveLength(2);
		expect(spawned[1]!.opts.storedir).toBe(join(root, "conv_1"));
	});

	it("delete 标记主动终止（exit 后不置 crashed）+ 删除会话目录", async () => {
		const { spawner, spawned } = makeFakeSpawner();
		const server = new ConversationManagerServer(noopFactory(), spawner, { storedirRoot: root });

		const ref = await server.spawnConversation({ agentType: "novel" });
		const dir = spawned[0]!.opts.storedir;
		const deletePromise = server.delete(ref.conversationId);
		spawned[0]!.child.exitTerminated();
		await deletePromise;

		expect(spawned[0]!.child.killed).toBe(true);
		expect(await server.list()).toHaveLength(0);
		expect(existsSync(dir)).toBe(false);
	});

	it("terminate 标记主动终止（exit 后 status stopped，目录保留）", async () => {
		const { spawner, spawned } = makeFakeSpawner();
		const server = new ConversationManagerServer(noopFactory(), spawner, { storedirRoot: root });

		const ref = await server.spawnConversation({ agentType: "novel" });
		const dir = spawned[0]!.opts.storedir;
		const terminatePromise = server.terminate(ref.conversationId);
		spawned[0]!.child.exitTerminated();
		await terminatePromise;

		expect(spawned[0]!.child.killed).toBe(true);
		expect((await server.list())[0]!.status).toBe("stopped");
		expect(existsSync(dir)).toBe(true);
	});

	it("崩溃重派生保留 parentId（F6 teammate 冒泡决策依赖）", async () => {
		const { spawner, spawned } = makeFakeSpawner();
		const server = new ConversationManagerServer(noopFactory(), spawner, { storedirRoot: root });

		const ref = await server.spawnConversation({ agentType: "novel", parentId: "root-1" });
		// 模拟崩溃 → 重派生
		spawned[0]!.child.exitCrashed();
		await server.createOrResume(ref.conversationId);
		expect(spawned).toHaveLength(2);
		const summary = (await server.list()).find((s) => s.conversationId === ref.conversationId);
		expect(summary?.parentId).toBe("root-1");
	});
});

describe("ConversationManagerServer（会话命名）", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "novel-mgr-name-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	/** 写 journal.jsonl（首行 = 首个 run，与 FileConversationJournalService 行格式一致） */
	function writeJournal(conversationId: string, firstUserText: string): void {
		const dir = join(root, conversationId);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "journal.jsonl"),
			JSON.stringify({
				seq: 1,
				run: { seq: 1, messages: [{ role: "user", content: firstUserText }], ts: "2026-08-05T09:00:00.000Z" },
			}) + "\n",
			"utf8",
		);
	}

	it("rename 更新摘要并写 meta.json（未知会话 / 空名返回 false）", async () => {
		const { spawner } = makeFakeSpawner();
		const server = new ConversationManagerServer(noopFactory(), spawner, { storedirRoot: root });
		const ref = await server.spawnConversation({ agentType: "novel" });

		expect(await server.rename(ref.conversationId, "  第三卷修订  ")).toBe(true);
		expect((await server.list())[0]!.name).toBe("第三卷修订");
		expect(existsSync(join(root, ref.conversationId, "meta.json"))).toBe(true);

		expect(await server.rename("conv_404", "名字")).toBe(false);
		expect(await server.rename(ref.conversationId, "   ")).toBe(false);
	});

	it("scanCatalog 恢复显式名（meta.json 优先于 journal 首句派生）", async () => {
		writeJournal("conv_1", "把雨景改成夜景，顺便加点风");
		writeFileSync(join(root, "conv_1", "meta.json"), JSON.stringify({ name: "雨景改稿" }), "utf8");
		const server = new ConversationManagerServer(noopFactory(), undefined, { storedirRoot: root });

		const list = await server.list();
		expect(list.find((s) => s.conversationId === "conv_1")!.name).toBe("雨景改稿");
	});

	it("scanCatalog 无显式名时用 journal 首句用户消息派生（超 30 字截断）", async () => {
		writeJournal("conv_1", "把雨景改成夜景，顺便加点风");
		const long = "一".repeat(42);
		writeJournal("conv_2", long);
		// conv_3：messages 首条非 user（system 转向），按 role 查找 user 消息派生
		mkdirSync(join(root, "conv_3"), { recursive: true });
		writeFileSync(
			join(root, "conv_3", "journal.jsonl"),
			JSON.stringify({
				seq: 1,
				run: {
					seq: 1,
					messages: [
						{ role: "system", content: "转向指令" },
						{ role: "user", content: "夜景带风" },
					],
					ts: "2026-08-05T09:00:00.000Z",
				},
			}) + "\n",
			"utf8",
		);
		// conv_4：无 journal → 回退 conversationId
		mkdirSync(join(root, "conv_4"), { recursive: true });

		const server = new ConversationManagerServer(noopFactory(), undefined, { storedirRoot: root });
		const list = await server.list();
		const nameOf = (id: string): string => list.find((s) => s.conversationId === id)!.name;
		expect(nameOf("conv_1")).toBe("把雨景改成夜景，顺便加点风");
		expect(nameOf("conv_2")).toBe(`${long.slice(0, 30)}…`);
		expect(nameOf("conv_3")).toBe("夜景带风");
		expect(nameOf("conv_4")).toBe("conv_4");
	});

	it("register 不冲刷显式名（子进程重启报到 name=conversationId 时保留）", async () => {
		const { spawner } = makeFakeSpawner();
		const server = new ConversationManagerServer(noopFactory(), spawner, { storedirRoot: root });
		const ref = await server.spawnConversation({ agentType: "novel" });
		await server.rename(ref.conversationId, "雨景改稿");

		await server.register({
			conversationId: ref.conversationId,
			name: ref.conversationId,
			storeDir: join(root, ref.conversationId),
		});
		expect((await server.list())[0]!.name).toBe("雨景改稿");
	});
});
