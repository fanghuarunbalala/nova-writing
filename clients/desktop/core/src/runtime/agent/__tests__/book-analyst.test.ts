import { describe, expect, it, vi } from "vitest";
import { buildBookAnalystAgent, BOOK_ANALYST_AGENT_TYPE } from "../BookAnalystAgent.js";
import type { NovelStore } from "../../../novel/store.js";
import type { Provider, ToolCall } from "../../provider/types.js";
import type { ToolDef } from "../../tool/ToolDef.js";

/**
 * BookAnalyst 装配回归（2026-08 真实书解析冒烟暴露的两处缺陷）：
 * 1. novel.entities 写工具必须免审批（后台无人审批会话，否则 NovelWrite 被
 *    「审批通道未装配」拒绝——大纲/人物/地点永远写不进 book.db）；
 * 2. NovelHandle 必须实现 mutateBatch（曾只实现 query/mutate 被 as 强转掩盖，
 *    NovelWrite 执行时报 handle.mutateBatch is not a function）。
 */

function mockStore() {
	return {
		query: vi.fn().mockResolvedValue({ outline: {}, units: [], volumes: [], chapters: [] }),
		mutate: vi.fn().mockResolvedValue({ ok: true }),
		mutateBatch: vi.fn().mockResolvedValue([{ version: 1, changeId: "c1", entity: "character" }]),
	} as unknown as NovelStore;
}

function build() {
	const store = mockStore();
	const loop = buildBookAnalystAgent({
		libraryRoot: "C:/fake/library",
		provider: {} as unknown as Provider,
		store,
		conversationId: "conv-test",
	});
	// AgentLoop.context 为 TS private（编译期），运行时属性可访问——装配回归需取工具面
	const context = loop as unknown as { context: { agentCapability: { toolDefs: ToolDef[]; nudgePolicies: Array<{ constructor: { name: string } }> } } };
	const tools = new Map(context.context.agentCapability.toolDefs.map((t) => [t.name, t]));
	return { store, tools, nudgeNames: context.context.agentCapability.nudgePolicies.map((n) => n.constructor.name) };
}

function call(name: string, args: Record<string, unknown>): ToolCall {
	return { id: "c1", name, args: JSON.stringify(args) };
}

describe("BookAnalyst 装配（novel.entities 免审批 + mutateBatch）", () => {
	it("nudge 接线：todo_idle + max_turn（enabled 声明序）", () => {
		const { nudgeNames } = build();
		expect(nudgeNames).toEqual(["TodoIdleNudgePolicy", "MaxTurnNudgePolicy"]);
	});

	it("agentType 为 BookAnalyst，NovelWrite/NovelEdit/NovelDelete 免审批", () => {
		expect(BOOK_ANALYST_AGENT_TYPE).toBe("BookAnalyst");
		const { tools } = build();
		for (const name of ["NovelWrite", "NovelEdit", "NovelDelete"]) {
			const tool = tools.get(name);
			expect(tool, `缺少工具 ${name}`).toBeDefined();
			expect(tool?.requireApproval, `${name} 应免审批`).not.toBe(true);
		}
	});

	it("NovelWrite 执行走 store.mutateBatch（回归：曾缺 mutateBatch 报 is not a function）", async () => {
		const { store, tools } = build();
		const write = tools.get("NovelWrite");
		expect(write).toBeDefined();
		await write!.handler.execute(call("NovelWrite", { kind: "character", values: [{ name: "克莱恩" }] }));
		expect(store.mutateBatch).toHaveBeenCalledWith([
			expect.objectContaining({ op: "character.create" }),
		]);
	});

	it("NovelRead 只读不触发 mutateBatch", async () => {
		const { store, tools } = build();
		const read = tools.get("NovelRead");
		expect(read).toBeDefined();
		await read!.handler.execute(call("NovelRead", { kind: "overview" }));
		expect(store.query).toHaveBeenCalled();
		expect(store.mutateBatch).not.toHaveBeenCalled();
	});
});
