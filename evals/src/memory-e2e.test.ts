/**
 * 记忆密闭评测（PRD memory-两层记忆 §6.2/6.3 起步四件；Tier-1 免 key）：
 * ① 写入质量（MemoryWrite 落盘 + 索引行 + 三段式 + source 宿主附加）
 * ② skip 生效率（NOVEL.md 已声明 → 拒绝写入，含「作者显式要求保存也适用」剧本）
 * ③ 跨会话召回 golden（seed memory 预置=会话1 产物，新会话 MemorySearch 命中）
 * ④ supersede（旧条目标 superseded 不进索引，新条目 active）
 * 走 evalCase + scriptedProvider（真实工具链：buildNovelAgent 默认 memoryDeps，
 * staticLayerTexts 读 seed 的 NOVEL.md，source=eval-会话#run 序号）。
 */
import { describe, it, expect } from "vitest";
import type { Provider, ProviderResult } from "@novel/core";
import { evalCase } from "./dsl.js";
import { jsonSubset, contains } from "./matcher.js";
import { memorySeedFiles } from "../cases/memorySeeds.js";

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

function toolCallResult(id: string, name: string, args: Record<string, unknown>): ProviderResult {
	return {
		finishReason: "tool_call",
		message: { role: "assistant", content: "", toolCalls: [{ id, name, args: JSON.stringify(args) }] },
	};
}

function finalMsg(text: string): ProviderResult {
	return { finishReason: "stop", message: { role: "assistant", content: text } };
}

/** 断言失败时打印失败面（name + actual）定位 */
function expectPassed(result: { passed: boolean; assertions: unknown[] }): void {
	const failed = JSON.stringify(
		(result.assertions as Array<{ name?: string; perRun?: Array<{ passed?: boolean; actual?: unknown }> }>)
			.filter((a) => !(a.perRun ?? []).every((p) => p.passed))
			.map((a) => ({ name: a.name, actual: a.perRun?.map((p) => p.actual) })),
	);
	expect(result.passed, failed).toBe(true);
}

describe("记忆密闭评测（memory-e2e）", () => {
	it("① 写入质量：MemoryWrite 落盘主题文件+索引行，source 宿主附加", async () => {
		const provider = scriptedProvider([
			toolCallResult("t1", "MemoryWrite", {
				name: "battle-style",
				type: "feedback",
				description: "打斗场面要短句为主",
				content: "## 规则/事实\n\n打斗短句。\n\n## Why\n\n作者嫌长句拖节奏。\n\n## How to apply\n\n战斗段落句长≤20字。",
			}),
			finalMsg("已记住打斗短句偏好。"),
		]);
		const result = await evalCase(
			{ task: "以后打斗都写短句，记住这个偏好" },
			{ provider },
		)
			.toolHasCalled("MemoryWrite")
			.toolArgs("MemoryWrite", jsonSubset({ name: "battle-style", type: "feedback" }))
			.file("memory/MEMORY.md", "- battle-style — 打斗场面要短句为主（feedback）")
			.custom((m) => {
				const topic = m.files["memory/battle-style.md"] ?? "";
				return (
					topic.includes("## 规则/事实") &&
					topic.includes("## How to apply") &&
					/#\d+$/.test(/source: (\S+)/.exec(topic)?.[1] ?? "") // source 宿主附加（会话#run 序号）
				);
			})
			.run();
		expectPassed(result);
	});

	it("② skip 生效率：NOVEL.md 已声明 → 拒绝（作者显式要求保存也适用）", async () => {
		const provider = scriptedProvider([
			toolCallResult("t1", "MemoryWrite", {
				name: "pov-note",
				type: "feedback",
				description: "人称：第一人称",
				content: "## 规则/事实\n\n本书用第一人称。",
			}),
			finalMsg("这条 NOVEL.md 已声明，不重复记。"),
		]);
		const result = await evalCase(
			{
				task: "记住：人称：第一人称",
				seed: { files: { "NOVEL.md": "# 项目约束\n- 人称：第一人称\n" } },
			},
			{ provider },
		)
			.toolResponse("MemoryWrite", contains("已拒绝写入"))
			.custom((m) => !("memory/pov-note.md" in m.files) && (m.files["memory/MEMORY.md"] ?? "") === "")
			.run();
		expectPassed(result);
	});

	it("③ 跨会话召回 golden：seed 记忆（会话1 产物）→ 新会话 MemorySearch 命中", async () => {
		const provider = scriptedProvider([
			toolCallResult("t1", "MemorySearch", { query: "打斗场面 要求" }),
			finalMsg("查到了：打斗场面要短句为主。"),
		]);
		const result = await evalCase(
			{
				task: "我之前对打斗场面提过什么要求？",
				seed: {
					files: memorySeedFiles([
						{
							name: "battle-style",
							type: "feedback",
							description: "打斗场面要短句为主",
							source: "conv_prev#3",
						},
						{ name: "pov-preference", type: "feedback", description: "人称偏好第一人称" },
					]),
				},
			},
			{ provider },
		)
			.toolHasCalled("MemorySearch")
			.toolArgs("MemorySearch", (args) => typeof args?.query === "string" && args.query.includes("打斗"))
			.toolResponse("MemorySearch", contains("battle-style"))
			.finalReplyContains("短句")
			.run();
		expectPassed(result);
	});

	it("④ supersede：旧条目标 superseded 留盘，索引只含新条目", async () => {
		const provider = scriptedProvider([
			toolCallResult("t1", "MemoryWrite", {
				name: "pov-preference",
				type: "feedback",
				description: "作者偏好第一人称叙事视角",
				content: "## 规则/事实\n\n用第一人称。",
			}),
			toolCallResult("t2", "MemoryWrite", {
				name: "pov-third",
				type: "feedback",
				description: "本书人称改用第三人称限知",
				content: "## 规则/事实\n\n改第三人称限知。",
				supersedes: "pov-preference",
			}),
			finalMsg("人称改口已记录。"),
		]);
		const result = await evalCase(
			{
				task: "先记住用第一人称；不对，改成都用第三人称限知",
				seed: { files: memorySeedFiles([{ name: "pov-preference", type: "feedback", description: "作者偏好第一人称叙事视角" }]) },
			},
			{ provider },
		)
			.file("memory/MEMORY.md", "pov-third")
			.custom((m) => {
				const index = m.files["memory/MEMORY.md"] ?? "";
				const old = m.files["memory/pov-preference.md"] ?? "";
				return (
					!index.includes("pov-preference") && // 旧条目不进索引
					old.includes("status: superseded") &&
					old.includes("superseded-by: pov-third")
				);
			})
			.run();
		expectPassed(result);
	});
});
