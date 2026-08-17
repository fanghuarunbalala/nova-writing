/**
 * Runner/DSL 密闭自测：scripted stub provider（新 run 自动重置脚本）驱动真装配
 * （buildNovelAgent + InMemoryNovelStore + 审批/提问通道），验证指标采集与断言聚合——
 * 不依赖 API key。错误双通道（error 字段 vs precheck result 文本）在此锁死。
 */
import { describe, it, expect } from "vitest";
import type { Provider, ProviderResult } from "@novel/core";
import { runAgent } from "./runner.js";
import { evalCase } from "./dsl.js";
import { jsonSubset, contains, regex } from "./matcher.js";

/**
 * 脚本化 provider：按序返回预置结果；检测到新 run 起点（上下文尚无 assistant
 * 消息——project_stage nudge 会在首 call 头插 system，不能按 messages 条数判定）
 * 时重置脚本，使 evalCase 的 repeats 各次执行看到相同剧本。
 */
function scriptedProvider(results: ProviderResult[]): Provider {
	let i = 0;
	return {
		call: async (call) => {
			if (!call.messages.some((m) => m.role === "assistant")) i = 0;
			const r = results[Math.min(i, results.length - 1)]!;
			i++;
			return r;
		},
		getModelInfo: (model: string) => ({
			model,
			supportsTemperature: true,
			thinkingMode: "none" as const,
			contextWindowTokens: 128_000,
		}),
	};
}

const writeCall = (id: string, values: unknown[]): ProviderResult => ({
	finishReason: "tool_call",
	message: {
		role: "assistant",
		content: "",
		toolCalls: [{ id, name: "NovelWrite", args: JSON.stringify({ kind: "character", values }) }],
	},
});

const finalMsg = (text: string): ProviderResult => ({
	finishReason: "stop",
	message: { role: "assistant", content: text },
});

describe("runAgent 密闭自测", () => {
	it("采集：turns / 工具轨迹 / 审批放行 / usage / 终态快照", async () => {
		const provider = scriptedProvider([
			writeCall("t1", [{ id: "char_linmo", name: "林默" }]),
			finalMsg("已创建角色林默。"),
		]);
		const m = await runAgent({ task: "创建角色林默" }, { provider });
		expect(m.ok).toBe(true);
		expect(m.turns).toBe(2);
		expect(m.toolCalls).toHaveLength(1);
		expect(m.toolCalls[0]!.name).toBe("NovelWrite");
		expect(m.toolCalls[0]!.result ?? "").toContain("applied");
		expect(m.toolCalls[0]!.error).toBeUndefined();
		expect(m.toolErrors).toHaveLength(0);
		expect(m.final).toBe("已创建角色林默。");
		const characters = m.storeSnapshot.characters as Array<{ id: string; name: string }>;
		expect(characters.some((c) => c.id === "char_linmo" && c.name === "林默")).toBe(true);
		expect(m.times.perTurnMs).toHaveLength(2);
	});

	it("错误双通道（precheck 路径）：duplicate id → result 文本 → TOOL_PRECHECK_FAILED", async () => {
		const provider = scriptedProvider([
			writeCall("t1", [{ id: "char_dup", name: "甲" }]),
			writeCall("t2", [{ id: "char_dup", name: "乙" }]),
			finalMsg("处理完成"),
		]);
		const m = await runAgent({ task: "重复创建" }, { provider });
		expect(m.turns).toBe(3);
		expect(m.toolCalls).toHaveLength(2);
		expect(m.toolErrors).toHaveLength(1);
		expect(m.toolErrors[0]!.code).toBe("TOOL_PRECHECK_FAILED");
		expect(m.toolErrors[0]!.toolName).toBe("NovelWrite");
		expect(m.toolCalls[1]!.error?.code).toBe("TOOL_PRECHECK_FAILED");
		// 终态只有第一次写入生效
		const characters = m.storeSnapshot.characters as Array<{ id: string }>;
		expect(characters.filter((c) => c.id === "char_dup")).toHaveLength(1);
	});

	it("错误双通道（handler 路径）：error 字段 + args 不可解析 → TOOL_ARGUMENTS_INVALID 推断", async () => {
		const provider = scriptedProvider([
			{
				finishReason: "tool_call",
				message: {
					role: "assistant",
					content: "",
					toolCalls: [{ id: "t1", name: "NovelWrite", args: "{not-json" }],
				},
			},
			finalMsg("完成"),
		]);
		const m = await runAgent({ task: "坏参数" }, { provider });
		expect(m.toolErrors).toHaveLength(1);
		expect(m.toolErrors[0]!.code).toBe("TOOL_ARGUMENTS_INVALID");
		expect(m.toolCalls[0]!.args).toBe("{not-json"); // 解析失败保留原文
	});

	it("seed 文件 + files 终态快照", async () => {
		const provider = scriptedProvider([finalMsg("好的")]);
		const m = await runAgent(
			{ task: "看一眼", seed: { files: { "notes.md": "seed 内容", "sub/dir.txt": "嵌套" } } },
			{ provider },
		);
		expect(m.files["notes.md"]).toBe("seed 内容");
		expect(m.files["sub/dir.txt"]).toBe("嵌套");
	});

	it("审批拒绝：deny 名单内的写工具被拒", async () => {
		const provider = scriptedProvider([
			writeCall("t1", [{ id: "char_x", name: "X" }]),
			finalMsg("被拒了"),
		]);
		const m = await runAgent(
			{ task: "创建", approvals: { deny: ["NovelWrite"] } },
			{ provider },
		);
		// 拒绝文本回填为 result（审批门控路径），角色未落库
		const characters = m.storeSnapshot.characters as Array<{ id: string }>;
		expect(characters.some((c) => c.id === "char_x")).toBe(false);
		expect(m.toolCalls[0]!.result ?? "").toContain("拒绝");
	});
});

describe("evalCase DSL 聚合", () => {
	it("断言矩阵 × repeats + passRate=1", async () => {
		const provider = scriptedProvider([
			writeCall("t1", [{ id: "char_a", name: "甲" }]),
			finalMsg("完成甲"),
		]);
		const result = await evalCase(
			{ task: "创建甲", repeats: 2, seed: { files: { "notes.md": "seed" } } },
			{ provider },
		)
			.toolHasCalled("NovelWrite")
			.toolNotCalled("AskUserQuestion")
			.finalReplyContains("甲")
			.file("notes.md", "seed")
			.turns({ min: 1, max: 3 })
			.run();
		expect(result.passed).toBe(true);
		expect(result.runs).toHaveLength(2);
		expect(result.assertions).toHaveLength(5);
		expect(result.aggregate.passRate).toBe(1);
		for (const a of result.assertions) {
			expect(a.perRun).toHaveLength(2);
			expect(a.perRun.every((p) => p.passed)).toBe(true);
		}
	});

	it("失败路径：必败断言 → passed=false，actual 可读", async () => {
		const provider = scriptedProvider([finalMsg("完成")]);
		const result = await evalCase({ task: "x", repeats: 2 }, { provider })
			.toolHasCalled("NovelDelete")
			.run();
		expect(result.passed).toBe(false);
		expect(result.aggregate.passRate).toBe(0);
		expect(result.assertions[0]!.perRun.every((p) => !p.passed)).toBe(true);
		expect(result.assertions[0]!.perRun[0]!.actual).toContain("0 次");
	});

	it("toolResponse：谓词与 jsonSubset 两种 matcher", async () => {
		const provider = scriptedProvider([
			writeCall("t1", [{ id: "char_a", name: "甲" }]),
			finalMsg("完成"),
		]);
		const byFn = await evalCase({ task: "x", repeats: 1 }, { provider })
			.toolResponse("NovelWrite", (value) => {
				const v = value as { items?: Array<{ status?: string }> };
				return Array.isArray(v.items) && v.items.some((i) => i.status === "applied");
			})
			.run();
		expect(byFn.passed).toBe(true);

		const byShape = await evalCase({ task: "x", repeats: 1 }, { provider })
			.toolResponse("NovelWrite", jsonSubset({ items: [{ status: "applied" }] }))
			.run();
		expect(byShape.passed).toBe(true);
	});
});

describe("matcher 单元", () => {
	it("jsonSubset：对象按键子集 / 数组按位前缀 / 标量相等 / RegExp 叶子", () => {
		const m = jsonSubset({ items: [{ status: "applied" }], name: /林/ });
		expect(
			m({ items: [{ id: "a", status: "applied" }, { id: "b", status: "applied" }], name: "林默" }, "{}"),
		).toBe(true);
		expect(m({ items: [{ status: "rejected" }] }, "{}")).toBe(false);
		expect(m({ items: [] }, "{}")).toBe(false);
		expect(m(null, "null")).toBe(false);
	});

	it("contains / regex 走 raw 通道", () => {
		expect(contains("applied")({ items: [] }, '{"items":[{"status":"applied"}]}')).toBe(true);
		expect(regex(/^预检未通过/)({}, "预检未通过(TOOL_PRECHECK_FAILED): x")).toBe(true);
	});
});
