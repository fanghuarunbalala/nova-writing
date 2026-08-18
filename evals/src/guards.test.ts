/**
 * 护栏与 preset 密闭自测（F4/F6 单元）：GuardEvaluator 各规则的触发/放行路径、
 * 缺省策略（未声明 guards 时零拦截）；compilePreset 的配对编译与非法输入报错。
 */
import { describe, it, expect } from "vitest";
import { GuardEvaluator, type EvalGuardsSpec } from "./guards.js";
import { compilePreset } from "./preset.js";
import { jsonSubset } from "./matcher.js";

const call = (name: string, args: unknown = {}) => ({
	name,
	args,
	argsRaw: JSON.stringify(args),
});

describe("GuardEvaluator", () => {
	it("未声明 guards → 零拦截（缺省策略）", () => {
		const g = new GuardEvaluator(undefined);
		expect(g.onRequest(call("NovelWrite"))).toBeNull();
		expect(g.onRequest(call("LibraryRead"))).toBeNull();
	});

	it("意外工具：声明 allowedTools 即启用，allowlist 外立即违规", () => {
		const g = new GuardEvaluator({ allowedTools: ["LibraryRead"] });
		expect(g.onRequest(call("LibraryRead", { kind: "overview" }))).toBeNull();
		const v = g.onRequest(call("NovelWrite"));
		expect(v?.rule).toBe("unexpected-tool");
		expect(v?.detail).toContain("NovelWrite");
	});

	it("顺序 strict：跳步/多余/耗尽后调用均违规；按序推进放行", () => {
		const spec: EvalGuardsSpec = {
			callSequence: {
				expect: [{ tool: "LibraryRead", args: jsonSubset({ kind: "overview" }) }, { tool: "NovelWrite" }],
			},
		};
		const ok = new GuardEvaluator(spec);
		expect(ok.onRequest(call("LibraryRead", { kind: "overview" }))).toBeNull();
		expect(ok.onRequest(call("NovelWrite"))).toBeNull();
		expect(ok.onRequest(call("NovelWrite"))?.rule).toBe("sequence"); // 耗尽后再调用

		const jump = new GuardEvaluator(spec);
		expect(jump.onRequest(call("NovelWrite"))?.rule).toBe("sequence"); // 跳过第 1 步
	});

	it("顺序 loose：期望调用须保持相对序，无关调用放行、越序违规", () => {
		const spec: EvalGuardsSpec = {
			callSequence: {
				expect: [{ tool: "LibraryRead" }, { tool: "NovelWrite" }],
				mode: "loose",
			},
		};
		const interleave = new GuardEvaluator(spec);
		expect(interleave.onRequest(call("TodoWrite"))).toBeNull(); // 无关调用放行
		expect(interleave.onRequest(call("LibraryRead"))).toBeNull();
		expect(interleave.onRequest(call("TodoWrite"))).toBeNull();
		expect(interleave.onRequest(call("NovelWrite"))).toBeNull();

		const reorder = new GuardEvaluator(spec);
		expect(reorder.onRequest(call("NovelWrite"))?.rule).toBe("sequence"); // 越过未完成的第 1 步
	});

	it("参数护栏：argsGuard 返回描述即违规；loop：连续同名同参达阈值违规", () => {
		const g = new GuardEvaluator({
			argsGuard: (c) =>
				c.name === "LibraryRead" &&
				(c.args as { bookId?: string }).bookId === "forbidden"
					? "bookId 越权"
					: null,
			loopDetect: { maxRepeats: 3 },
		});
		expect(g.onRequest(call("LibraryRead", { bookId: "ok" }))).toBeNull();
		expect(g.onRequest(call("LibraryRead", { bookId: "forbidden" }))?.rule).toBe("args");
		expect(g.onRequest(call("X", { a: 1 }))).toBeNull();
		expect(g.onRequest(call("X", { a: 1 }))).toBeNull();
		expect(g.onRequest(call("X", { a: 1 }))?.rule).toBe("loop");
		expect(g.onRequest(call("X", { a: 2 }))).toBeNull(); // 参数变化重置计数
	});
});

describe("compilePreset", () => {
	it("简化格式编译：toolCallId 自动生成并配对 tool 结果", () => {
		const out = compilePreset([
			{ role: "user", content: "看看书库" },
			{
				role: "assistant",
				content: "",
				toolCalls: [{ name: "LibraryRead", args: { kind: "overview" } }],
			},
			{ role: "tool", forCall: 1, content: "书目如下" },
			{ role: "assistant", content: "书库里有一本《雨夜旧事》。" },
		]);
		expect(out).toHaveLength(4);
		expect(out[0]).toEqual({ role: "user", content: "看看书库" });
		const assistant = out[1]!;
		expect(assistant.role).toBe("assistant");
		if (assistant.role === "assistant") {
			expect(assistant.toolCalls?.[0]!.name).toBe("LibraryRead");
			expect(assistant.toolCalls?.[0]!.args).toBe(JSON.stringify({ kind: "overview" }));
		}
		const tool = out[2]!;
		if (tool.role === "tool") {
			expect(tool.content).toBe("书目如下");
			expect(tool.id).toBe((out[1] as { toolCalls: Array<{ id: string }> }).toolCalls[0]!.id);
		}
	});

	it("raw LLMessage[] 透传", () => {
		const out = compilePreset([
			{ role: "user", content: "hi" },
			{
				role: "assistant",
				content: "",
				toolCalls: [{ id: "tc1", name: "T", args: "{}" }],
			},
			{ role: "tool", content: "r", id: "tc1" },
		]);
		expect(out).toHaveLength(3);
		expect((out[2] as { id?: string }).id).toBe("tc1");
	});

	it("非法输入：孤儿 tool 结果 / forCall 越界 / 未配对 toolCall", () => {
		expect(() => compilePreset([{ role: "tool", forCall: 1, content: "x" }])).toThrow(
			/没有前置/,
		);
		expect(() =>
			compilePreset([
				{ role: "assistant", content: "", toolCalls: [{ name: "T", args: {} }] },
				{ role: "tool", forCall: 2, content: "x" },
			]),
		).toThrow(/越界/);
		expect(() =>
			compilePreset([
				{ role: "assistant", content: "", toolCalls: [{ name: "T", args: {} }, { name: "U", args: {} }] },
				{ role: "tool", forCall: 1, content: "x" },
				{ role: "user", content: "next" },
			]),
		).toThrow(/未配对/);
	});
});
