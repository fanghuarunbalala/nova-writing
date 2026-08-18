/**
 * 书库评测执行语义密闭 e2e（F3/F4/F6/F7 汇合）：scripted stub provider 驱动真装配
 * （buildNovelAgent + 桩 library deps + 护栏 + preset），验证 Runner 注入闭环——
 * libraryCalls/citations 采集、护栏提前终止与 abort 记录、expectedAbort 负向判定、
 * 预置会话史进上下文与短跑。夹具在 tmp 内现场构建（env 覆盖根，免 key 全密闭）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LLMessage, Provider, ProviderResult } from "@novel/core";
import { runAgent } from "./runner.js";
import { evalCase } from "./dsl.js";
import { buildFixturePackDir } from "./fixture/build.js";
import { expectedAbort, expectToolCalls, returnedParagraphIds } from "./assertions.js";
import { jsonSubset } from "./matcher.js";

const ALIAS = "e2ebk";

/** 10 章小书（每章一批 → 第 n 章 pid = e2ebk-p00000n） */
const BOOK = Array.from({ length: 10 }, (_, i) => `第${i + 1}章 章${i + 1}\n第${i + 1}章的正文。`).join(
	"\n\n",
);

let root: string;

/** provider 脚本：按序消耗（单 run 用，不复位） */
function scriptedProvider(results: ProviderResult[], capture?: LLMessage[][]): Provider {
	let i = 0;
	return {
		call: async (call) => {
			capture?.push(call.messages);
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

const libraryCall = (id: string, kind: string, extra: Record<string, unknown>): ProviderResult => ({
	finishReason: "tool_call",
	message: {
		role: "assistant",
		content: "",
		toolCalls: [{ id, name: "LibraryRead", args: JSON.stringify({ kind, ...extra }) }],
	},
});

const writeCall = (id: string): ProviderResult => ({
	finishReason: "tool_call",
	message: {
		role: "assistant",
		content: "",
		toolCalls: [
			{ id, name: "NovelWrite", args: JSON.stringify({ kind: "character", values: [{ id: "c1", name: "甲" }] }) },
		],
	},
});

const finalMsg = (text: string): ProviderResult => ({
	finishReason: "stop",
	message: { role: "assistant", content: text },
});

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "novel-lib-e2e-"));
	const sourcePath = join(root, "book.txt");
	await writeFile(sourcePath, BOOK, "utf8");
	const dir = join(root, ALIAS);
	await mkdir(join(dir, "fabricated"), { recursive: true });
	await writeFile(
		join(dir, "fabricated", "style.md"),
		"# 风格\n- 短句（例证：e2ebk-p000001）。\n",
		"utf8",
	);
	await writeFile(join(dir, "fabricated", "entities.json"), JSON.stringify({ mutations: [] }), "utf8");
	await writeFile(join(dir, "ground-truth.json"), JSON.stringify({ schema: 1 }), "utf8");
	await buildFixturePackDir({ sourcePath, alias: ALIAS, root });
	process.env.NOVEL_EVAL_FIXTURES = root;
});

afterAll(async () => {
	delete process.env.NOVEL_EVAL_FIXTURES;
	await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe("Runner 书库注入闭环", () => {
	// library.read 暂不接入 main（主 agent 工具面撤除）——LibraryRead 闭环用例随
	// book-analyst 分支恢复；此处 skip 保留用例代码（恢复 = 去 .skip）
	it.skip("library：overview → paragraph 调用被采集；cited/valid 信息边界成立", async () => {
		const provider = scriptedProvider([
			libraryCall("t1", "overview", {}),
			libraryCall("t2", "paragraph", { bookId: ALIAS, chapterNo: 5 }),
			finalMsg(`第5章见 ${ALIAS}-p000005；另一处 ${ALIAS}-p000009。`),
		]);
		const m = await runAgent(
			{ task: `读第5章并回答`, library: { book: ALIAS } },
			{ provider },
		);
		expect(m.ok).toBe(true);
		expect(m.toolCalls.map((c) => c.name)).toEqual(["LibraryRead", "LibraryRead"]);
		// 只读了第 5 章 → p000005 在实际返回集合，p000009 是幻觉引用
		expect(m.libraryCalls?.map((c) => c.kind)).toEqual(["overview", "paragraph"]);
		expect(m.citations?.cited).toEqual([`${ALIAS}-p000005`, `${ALIAS}-p000009`]);
		expect(m.citations?.valid).toEqual([`${ALIAS}-p000005`]);
		expect(returnedParagraphIds(m).has(`${ALIAS}-p000005`)).toBe(true);
	});

	it.skip("mock 脚本：listBooks 首次返回脚本内容（toolResponse 可断言）", async () => {
		const provider = scriptedProvider([
			libraryCall("t1", "overview", {}),
			finalMsg("完成"),
		]);
		const m = await runAgent(
			{
				task: "看书库",
				library: {
					book: ALIAS,
					mock: {
						entries: [
							{
								match: { method: "listBooks" },
								responses: [JSON.stringify([{ bookId: ALIAS, title: "脚本书名" }])],
							},
						],
					},
				},
			},
			{ provider },
		);
		expect(m.toolCalls[0]!.result ?? "").toContain("脚本书名");
		expect(m.libraryCalls?.[0]!.source).toBe("script");
	});

	it("护栏：意外工具 → 提前终止 + abort 记录 + ok=false（rule 归因）", async () => {
		const provider = scriptedProvider([
			writeCall("t1"),
			libraryCall("t2", "overview", {}),
			finalMsg("不该到这"),
		]);
		const m = await runAgent(
			{
				task: "只读书",
				library: { book: ALIAS },
				guards: { allowedTools: ["LibraryRead"] },
			},
			{ provider },
		);
		expect(m.ok).toBe(false);
		expect(m.abort?.rule).toBe("unexpected-tool");
		expect(m.abort?.toolCall.name).toBe("NovelWrite");
		expect(m.error ?? "").toContain("护栏终止(unexpected-tool)");
	});

	it("expectedAbort 负向：违规如期发生 → case 判通过（护栏与判定解耦）", async () => {
		const provider = scriptedProvider([writeCall("t1"), finalMsg("x")]);
		const result = await evalCase(
			{
				task: "只读书",
				repeats: 1,
				library: { book: ALIAS },
				guards: { allowedTools: ["LibraryRead"] },
			},
			{ provider },
		)
			.custom(expectedAbort("unexpected-tool"))
			.run();
		expect(result.passed).toBe(true);
		expect(result.assertions[0]!.perRun[0]!.actual).toContain("unexpected-tool");
	});

	it("expectToolCalls：subset 满足即过（多余调用不判失败）", async () => {
		const provider = scriptedProvider([
			libraryCall("t1", "overview", {}),
			libraryCall("t2", "paragraph", { bookId: ALIAS, chapterNo: 1 }),
			finalMsg("完成"),
		]);
		const result = await evalCase(
			{ task: "读第1章", repeats: 1, library: { book: ALIAS } },
			{ provider },
		)
			.custom(expectToolCalls([{ tool: "LibraryRead", args: jsonSubset({ kind: "overview" }) }]))
			.run();
		expect(result.passed).toBe(true);

		const failProvider = scriptedProvider([finalMsg("没调工具")]);
		const failed = await evalCase(
			{ task: "读第1章", repeats: 1, library: { book: ALIAS } },
			{ provider: failProvider },
		)
			.custom(expectToolCalls([{ tool: "LibraryRead" }]))
			.run();
		expect(failed.passed).toBe(false);
		expect(failed.assertions[0]!.perRun[0]!.actual).toContain("未满足的预期步");
	});

	it("preset 短跑：预置历史进首轮 provider 上下文；单 turn 收口", async () => {
		const captured: LLMessage[][] = [];
		const provider = scriptedProvider([finalMsg("下一步该细读第 5 章。")], captured);
		const m = await runAgent(
			{
				task: "继续",
				repeats: 1,
				library: { book: ALIAS },
				budget: { maxTurns: 3 },
				preset: {
					messages: [
						{ role: "user", content: "帮我读这本书" },
						{
							role: "assistant",
							content: "",
							toolCalls: [{ name: "LibraryRead", args: { kind: "overview" } }],
						},
						{ role: "tool", forCall: 1, content: "书目：e2ebk（10 章）" },
						{ role: "assistant", content: "书库里有一本 10 章的书。" },
					],
				},
			},
			{ provider },
		);
		expect(m.ok).toBe(true);
		expect(m.turns).toBe(1);
		const first = captured[0]!;
		// 预置历史（含 tool 结果）与本次任务消息同在首轮上下文
		expect(first.some((msg) => msg.role === "tool" && msg.content.includes("10 章"))).toBe(true);
		expect(first.some((msg) => msg.role === "user" && msg.content === "继续")).toBe(true);
	});

	it("缺夹具：构造期明确报错（不静默跳过；evalCase 收口为 failedMetrics）", async () => {
		const provider = scriptedProvider([finalMsg("ok")]);
		await expect(
			runAgent({ task: "x", library: { book: "nope" } }, { provider }),
		).rejects.toThrow(/夹具包缺失/);
		const result = await evalCase(
			{ task: "x", repeats: 1, library: { book: "nope" } },
			{ provider },
		)
			.finalReplyContains("不该到这里")
			.run();
		expect(result.passed).toBe(false);
		expect(result.runs[0]!.error ?? "").toContain("夹具包缺失");
	});
});
