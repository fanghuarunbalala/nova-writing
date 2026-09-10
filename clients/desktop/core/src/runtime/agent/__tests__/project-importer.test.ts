import { describe, expect, it } from "vitest";
import {
	PROJECT_IMPORTER_AGENT_TYPE,
	projectImporterAgentDefinition,
} from "../definitions/ProjectImporterAgentDefinition.js";
import { buildNovelAgent } from "../NovelAgent.js";
import { InMemoryNovelStore } from "../../../novel/InMemoryNovelStore.js";
import type { NovelStore } from "../../../novel/store.js";
import type { Provider } from "../../provider/types.js";
import type { ToolDef } from "../../tool/ToolDef.js";

/**
 * ProjectImporter 装配回归：novel 装配 + 派生定义（definition 注入）必须成功组装，
 * 工具面为 novel 后台子集（todo/files/entities），无 ask/compose/subagent 工具。
 */

function inMemoryHandle(store: NovelStore) {
	return {
		query: (q: unknown) => store.query(q as never),
		mutate: (m: unknown) => store.mutate(m as never),
		mutateBatch: (ms: readonly unknown[]) => store.mutateBatch(ms as never[]),
	} as never;
}

function build() {
	const handle = inMemoryHandle(new InMemoryNovelStore());
	const loop = buildNovelAgent({
		workspace: "C:/fake/workspace",
		provider: {} as unknown as Provider,
		handle,
		conversationId: "conv-import-test",
		definition: projectImporterAgentDefinition,
		// novel.import 组（NovelImportText）：原始（未守卫）handle 写通道
		importText: { handle: handle as never },
	});
	// AgentLoop.context 为 TS private（编译期），运行时属性可访问——取工具面断言
	const context = loop as unknown as { context: { agentCapability: { toolDefs: ToolDef[]; nudgePolicies: Array<{ constructor: { name: string } }> } } };
	const tools = new Map(context.context.agentCapability.toolDefs.map((t) => [t.name, t]));
	return { tools, nudgeNames: context.context.agentCapability.nudgePolicies.map((n) => n.constructor.name) };
}

describe("ProjectImporter 定义与装配", () => {
	it("nudge 接线：todo_idle + max_turn（经 buildNovelAgent 共用目录，enabled 声明序）", () => {
		const { nudgeNames } = build();
		expect(nudgeNames).toEqual(["TodoIdleNudgePolicy", "MaxTurnNudgePolicy"]);
	});

	it("agentType 为 ProjectImporter；recipe 段全部可解析（装配不抛错即通过）", () => {
		expect(PROJECT_IMPORTER_AGENT_TYPE).toBe("ProjectImporter");
		expect(projectImporterAgentDefinition.delegation.mode).toBe("disabled");
		expect(() => build()).not.toThrow();
	});

	it("工具面 = novel 后台子集：todo/files/entities/import 在，ask/compose/subagent 不在", () => {
		const { tools } = build();
		for (const name of ["TodoWrite", "Read", "Glob", "Write", "Edit", "NovelRead", "NovelWrite", "NovelEdit", "NovelDelete", "NovelImportText"]) {
			expect(tools.has(name), `缺少工具 ${name}`).toBe(true);
		}
		for (const name of ["AskUserQuestion", "EnterComposeMode", "ExitComposeMode", "Agent", "TaskOutput", "TaskStop", "LibraryRead"]) {
			expect(tools.has(name), `不应装配 ${name}`).toBe(false);
		}
	});
});
