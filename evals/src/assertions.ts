/**
 * 断言辅助（docs/PRD/evals-书库真实评测.md F5）：custom(fn) 包装的判定面扩展——
 * 不加 DSL 断言词表，返回 {passed, actual} 形态（dsl.custom 的 Verdict 通道）直达报告。
 * 词表：expectToolCalls（预期调用脚本，缺省 subset）/ expectedAbort（护栏违规负向断言）/
 * returnedParagraphIds（信息边界集合）/ toolArgsJudge（工具参数作 judge 载荷）。
 */
import type { EvalRunMetrics, ToolCallTrace } from "./types.js";
import type { Verdict } from "./dsl.js";
import { toMatcher } from "./matcher.js";
import type { ValueMatcher } from "./matcher.js";
import { judgeText } from "./judge.js";

/** 预期工具步（与 guards.GuardToolExpect 同形；string args = contains raw） */
export interface ToolCallExpect {
	tool: string;
	args?: string | ValueMatcher;
}

function callMatches(
	c: ToolCallTrace,
	e: ToolCallExpect,
): boolean {
	return e.tool === c.name && (e.args === undefined || toMatcher(e.args)(c.args, c.argsRaw));
}

function callsDesc(calls: readonly ToolCallTrace[]): string {
	return calls.length === 0 ? "（无调用）" : calls.map((c) => c.name).join(", ");
}

/**
 * 预期工具调用脚本：subset（缺省）= 每个预期步至少被一次调用满足，多余调用不判失败
 * （意外调用归 guards.allowedTools 硬停管辖）；sequence = 预期步须为实际调用的有序子序列。
 */
export function expectToolCalls(
	expected: ReadonlyArray<ToolCallExpect>,
	opts: { mode?: "subset" | "sequence" } = {},
): (m: EvalRunMetrics) => Verdict {
	const mode = opts.mode ?? "subset";
	return (m) => {
		if (mode === "subset") {
			const missing = expected
				.map((e) => (m.toolCalls.some((c) => callMatches(c, e)) ? null : e.tool))
				.filter((v): v is string => v !== null);
			return {
				passed: missing.length === 0,
				actual:
					missing.length === 0
						? `${expected.length} 个预期步全部满足；实际调用：${callsDesc(m.toolCalls)}`
						: `未满足的预期步：${missing.join(", ")}；实际调用：${callsDesc(m.toolCalls)}`,
			};
		}
		// sequence：有序子序列（越过的预期步 = 失败）
		let ptr = 0;
		for (const c of m.toolCalls) {
			if (ptr < expected.length && callMatches(c, expected[ptr]!)) ptr++;
		}
		const consumed = expected.slice(0, ptr).map((e) => e.tool);
		return {
			passed: ptr === expected.length,
			actual:
				ptr === expected.length
					? `按序完成 ${expected.length} 步（${consumed.join(" → ")}）`
					: `仅推进到第 ${ptr}/${expected.length} 步（${consumed.join(" → ") || "未开始"}）；实际调用：${callsDesc(m.toolCalls)}`,
		};
	};
}

/**
 * 护栏违规负向断言（F4）：期望中的违规如期发生 = 该 run 通过。
 * rule 缺省匹配任意规则；无 abort 或规则不符 = 失败（actual 给出实际情况）。
 */
export function expectedAbort(
	rule?: string,
): (m: EvalRunMetrics) => Verdict {
	return (m) => {
		if (m.abort === undefined) {
			return { passed: false, actual: "未发生护栏终止（run 正常收口）" };
		}
		const matched = rule === undefined || m.abort.rule === rule;
		return {
			passed: matched,
			actual: `${m.abort.rule}：${m.abort.detail} @T${m.abort.turn}${matched ? "" : `（期望 ${rule}）`}`,
		};
	};
}

/** 本 run 经 LibraryRead 实际返回过的 pid 集合（引用信息边界断言的基准） */
export function returnedParagraphIds(m: EvalRunMetrics): Set<string> {
	return new Set((m.libraryCalls ?? []).flatMap((c) => c.returnedParagraphIds ?? []));
}

/**
 * 工具参数作 judge 载荷（F5 判定面泛化）：对该工具的每次调用参数独立 judge，
 * 取最差结果（任一次不过即不过）；未调用该工具 = 失败。
 * 例：NovelWrite 的 story_unit synopsis 幕级四要素评判（reference 可附原书参照）。
 */
export function toolArgsJudge(
	toolName: string,
	rubric: string,
	opts: { reference?: string; model?: string; scoreAtLeast?: number } = {},
): (m: EvalRunMetrics) => Promise<Verdict> {
	return async (m) => {
		const calls = m.toolCalls.filter((c) => c.name === toolName);
		if (calls.length === 0) {
			return { passed: false, actual: `${toolName} 未被调用（无可判参数）` };
		}
		let worst: { passed: boolean; score: number; reason: string } | undefined;
		for (const [i, c] of calls.entries()) {
			const verdict = await judgeText({
				payloadLabel: `${toolName} 参数（第 ${i + 1} 次调用）`,
				payload: c.argsRaw,
				rubric,
				...(opts.reference !== undefined ? { reference: opts.reference } : {}),
				...(opts.model !== undefined ? { model: opts.model } : {}),
				...(opts.scoreAtLeast !== undefined ? { scoreAtLeast: opts.scoreAtLeast } : {}),
			});
			if (worst === undefined || (!verdict.passed && worst.passed) || verdict.score < worst.score) {
				worst = verdict;
			}
		}
		return {
			passed: worst!.passed,
			actual: `${calls.length} 次调用取最差：${worst!.passed ? "过" : "不过"}（score=${worst!.score}）${worst!.reason}`,
		};
	};
}
