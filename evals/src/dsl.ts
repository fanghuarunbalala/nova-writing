/**
 * 链式断言 DSL（docs/PRD/eval-harness.md §3.3–§3.7）：
 * evalCase(input) → 断言链（收集，不执行）→ .run() 执行 ×repeats、
 * 全量求值（无短路、AND）→ passRate ≥ threshold 判定 → EvalResult。
 * 不加断言直接 .run() 即第一层纯采集。
 */
import type {
	AssertionReport,
	EvalInput,
	EvalResult,
	EvalRunMetrics,
	ToolCallTrace,
} from "./types.js";
import { runAgent, type RunAgentOptions } from "./runner.js";
import { judgeFinalReply } from "./judge.js";
import { parseIfJson, toMatcher, type ValueMatcher } from "./matcher.js";

/** 单次求值结果：判定与 actual 描述同源产出（judge 类断言只调一次） */
export interface Verdict {
	passed: boolean;
	actual: string;
}

export interface AssertionDef {
	name: string;
	evaluate: (m: EvalRunMetrics) => Verdict | Promise<Verdict>;
}

function truncate(s: string, max = 120): string {
	return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function countOf(calls: readonly ToolCallTrace[], name: string): number {
	return calls.filter((c) => c.name === name).length;
}

function errorHistogram(m: EvalRunMetrics): string {
	if (m.toolErrors.length === 0) return "无";
	const byCode = new Map<string, number>();
	for (const e of m.toolErrors) {
		byCode.set(e.code, (byCode.get(e.code) ?? 0) + 1);
	}
	return [...byCode.entries()].map(([code, n]) => `${code}×${n}`).join(", ");
}

/** runAgent 抛出（装配失败等）时的兜底 metrics：断言对它全部不过 */
export function failedMetrics(e: unknown): EvalRunMetrics {
	return {
		ok: false,
		error: e instanceof Error ? e.message : String(e),
		turns: 0,
		toolCalls: [],
		toolErrors: [],
		usage: { inputTokens: 0, outputTokens: 0 },
		times: { totalMs: 0, perTurnMs: [] },
		final: "",
		storeSnapshot: {
			overview: null,
			characters: null,
			locations: null,
			paragraphs: null,
			outline: null,
			publication: null,
		},
		files: {},
	};
}

export class EvalCaseBuilder {
	private readonly assertions: AssertionDef[] = [];
	private thresholdRatio = 1;

	constructor(
		private readonly input: EvalInput,
		private readonly runOpts?: RunAgentOptions,
	) {}

	/** 工具被调用过（≥1 次） */
	toolHasCalled(name: string): this {
		return this.push(`toolHasCalled(${name})`, (m) => ({
			passed: countOf(m.toolCalls, name) >= 1,
			actual: `${countOf(m.toolCalls, name)} 次`,
		}));
	}

	/** 工具从未被调用 */
	toolNotCalled(name: string): this {
		return this.push(`toolNotCalled(${name})`, (m) => ({
			passed: countOf(m.toolCalls, name) === 0,
			actual: `${countOf(m.toolCalls, name)} 次`,
		}));
	}

	/** 调用次数区间 */
	toolCallCount(name: string, range: { min?: number; max?: number }): this {
		const min = range.min ?? 0;
		const max = range.max ?? Number.POSITIVE_INFINITY;
		const maxDesc = max === Number.POSITIVE_INFINITY ? "∞" : String(max);
		return this.push(`toolCallCount(${name}, min=${min}, max=${maxDesc})`, (m) => {
			const n = countOf(m.toolCalls, name);
			return { passed: n >= min && n <= max, actual: `${n} 次` };
		});
	}

	/** 某次调用的参数匹配（存在一次即过；value=解析后 args，raw=原始 JSON 文本） */
	toolArgs(name: string, matcher: string | ValueMatcher): this {
		const mfn = toMatcher(matcher);
		const hits = (m: EvalRunMetrics) =>
			m.toolCalls.filter((c) => c.name === name && mfn(c.args, c.argsRaw));
		return this.push(`toolArgs(${name})`, (m) => ({
			passed: hits(m).length >= 1,
			actual: `${hits(m).length}/${countOf(m.toolCalls, name)} 次匹配`,
		}));
	}

	/** 某次响应的 result 匹配（存在一次即过；value=可解析 JSON，raw=原文） */
	toolResponse(name: string, matcher: string | ValueMatcher): this {
		const mfn = toMatcher(matcher);
		const hits = (m: EvalRunMetrics) =>
			m.toolCalls.filter(
				(c) =>
					c.name === name &&
					c.result !== undefined &&
					mfn(parseIfJson(c.result), c.result),
			);
		return this.push(`toolResponse(${name})`, (m) => ({
			passed: hits(m).length >= 1,
			actual: `${hits(m).length}/${countOf(m.toolCalls, name)} 次匹配`,
		}));
	}

	/** 工具错误约束（code/toolName 过滤；max 缺省 0，min 用于失败自愈 case） */
	anyToolError(
		spec: { code?: string; toolName?: string; min?: number; max?: number } = {},
	): this {
		const min = spec.min ?? 0;
		const max = spec.max ?? 0;
		const desc = [
			spec.code !== undefined ? `code=${spec.code}` : null,
			spec.toolName !== undefined ? `tool=${spec.toolName}` : null,
			`min=${min}`,
			`max=${max}`,
		]
			.filter((v) => v !== null)
			.join(", ");
		const matched = (m: EvalRunMetrics) =>
			m.toolErrors.filter(
				(e) =>
					(spec.code === undefined || e.code === spec.code) &&
					(spec.toolName === undefined || e.toolName === spec.toolName),
			);
		return this.push(`anyToolError(${desc})`, (m) => {
			const n = matched(m).length;
			return { passed: n >= min && n <= max, actual: `${n} 次（${errorHistogram(m)}）` };
		});
	}

	/** turn 次数区间 */
	turns(range: { min?: number; max?: number } = {}): this {
		const min = range.min ?? 0;
		const max = range.max ?? Number.POSITIVE_INFINITY;
		const maxDesc = max === Number.POSITIVE_INFINITY ? "∞" : String(max);
		return this.push(`turns(min=${min}, max=${maxDesc})`, (m) => ({
			passed: m.turns >= min && m.turns <= max,
			actual: `${m.turns} turns`,
		}));
	}

	/** 最终回复包含子串（数组 = 全部包含） */
	finalReplyContains(text: string | readonly string[]): this {
		const parts = Array.isArray(text) ? text : [text];
		const desc = parts.map((p) => truncate(p, 30)).join(" & ");
		return this.push(`finalReplyContains(${desc})`, (m) => ({
			passed: parts.every((p) => m.final.includes(p)),
			actual: truncate(m.final, 80),
		}));
	}

	/** 最终回复正则 */
	finalReplyRegex(re: RegExp): this {
		return this.push(`finalReplyRegex(${re})`, (m) => ({
			passed: re.test(m.final),
			actual: truncate(m.final, 80),
		}));
	}

	/** 最终回复任意谓词 */
	finalReplyFn(fn: (final: string) => boolean): this {
		return this.push("finalReplyFn(…)", (m) => ({
			passed: fn(m.final),
			actual: truncate(m.final, 80),
		}));
	}

	/** LLM-as-judge 按 rubric 判定最终回复（每 repeat 一次独立 judge 调用，判定与理由同源） */
	finalReplyJudge(
		rubric: string,
		opts: { model?: string; scoreAtLeast?: number } = {},
	): this {
		const taskText = Array.isArray(this.input.task)
			? this.input.task.join("\n")
			: this.input.task;
		return this.push(`finalReplyJudge(${truncate(rubric, 40)})`, async (m) => {
			const verdict = await judgeFinalReply({
				task: taskText,
				finalReply: m.final,
				rubric,
				...(opts.model !== undefined ? { model: opts.model } : {}),
				...(opts.scoreAtLeast !== undefined ? { scoreAtLeast: opts.scoreAtLeast } : {}),
			});
			return {
				passed: verdict.passed,
				actual: `${verdict.passed ? "过" : "不过"}（score=${verdict.score}）${verdict.reason}`,
			};
		});
	}

	/** novel 终态断言（只读快照视图） */
	store(fn: (s: EvalRunMetrics["storeSnapshot"]) => boolean): this {
		return this.push("store(…)", (m) => ({
			passed: fn(m.storeSnapshot),
			actual: truncate(
				JSON.stringify({
					characters: Array.isArray(m.storeSnapshot.characters)
						? m.storeSnapshot.characters.length
						: m.storeSnapshot.characters,
					paragraphs: Array.isArray(m.storeSnapshot.paragraphs)
						? m.storeSnapshot.paragraphs.length
						: m.storeSnapshot.paragraphs,
				}),
			),
		}));
	}

	/** 工作区文件断言（内容匹配） */
	file(path: string, matcher: string | ValueMatcher): this {
		const mfn = toMatcher(matcher);
		return this.push(`file(${path})`, (m) => {
			const content = m.files[path];
			return {
				passed: content !== undefined && mfn(content, content),
				actual: content === undefined ? "文件不存在" : truncate(content, 80),
			};
		});
	}

	/** token 预算 */
	usage(limits: { maxInput?: number; maxOutput?: number }): this {
		const inDesc = limits.maxInput === undefined ? "∞" : String(limits.maxInput);
		const outDesc = limits.maxOutput === undefined ? "∞" : String(limits.maxOutput);
		return this.push(`usage(maxInput=${inDesc}, maxOutput=${outDesc})`, (m) => ({
			passed:
				(limits.maxInput === undefined || m.usage.inputTokens <= limits.maxInput) &&
				(limits.maxOutput === undefined || m.usage.outputTokens <= limits.maxOutput),
			actual: `in=${m.usage.inputTokens}, out=${m.usage.outputTokens}`,
		}));
	}

	/** 逃生舱：任意谓词，收完整 EvalRunMetrics */
	custom(fn: (m: EvalRunMetrics) => boolean | Promise<boolean>): this {
		return this.push("custom(…)", async (m) => ({
			passed: await fn(m),
			actual: `ok=${m.ok}, turns=${m.turns}, errors=${m.toolErrors.length}`,
		}));
	}

	/** case 级 passRate 阈值（缺省 1.0；含 judge 的 case 建议 2/3） */
	threshold(ratio: number): this {
		this.thresholdRatio = ratio;
		return this;
	}

	/** @internal compile 层（evalite scorer 编译）读取已注册断言；须在断言链完成后调用 */
	defs(): readonly AssertionDef[] {
		return this.assertions;
	}

	/** 执行：×repeats 采集 → 断言逐次全量求值（无短路 AND）→ 聚合 */
	async run(): Promise<EvalResult> {
		const repeats = this.input.repeats ?? 3;
		const runs: EvalRunMetrics[] = [];
		for (let i = 0; i < repeats; i++) {
			try {
				runs.push(await runAgent(this.input, this.runOpts));
			} catch (e) {
				runs.push(failedMetrics(e));
			}
		}

		const assertions: AssertionReport[] = [];
		const runAllPassed: boolean[] = runs.map(() => true);
		for (const def of this.assertions) {
			const report: AssertionReport = { name: def.name, perRun: [] };
			for (const [runIndex, m] of runs.entries()) {
				let verdict: Verdict;
				try {
					verdict = await def.evaluate(m);
				} catch (e) {
					verdict = {
						passed: false,
						actual: `断言执行出错：${e instanceof Error ? e.message : String(e)}`,
					};
				}
				report.perRun.push({ run: runIndex, passed: verdict.passed, actual: verdict.actual });
				if (!verdict.passed) runAllPassed[runIndex] = false;
			}
			assertions.push(report);
		}

		const passedRuns = runAllPassed.filter(Boolean).length;
		const passRate = repeats === 0 ? 0 : passedRuns / repeats;
		return {
			passed: passRate >= this.thresholdRatio - 1e-9,
			runs,
			assertions,
			aggregate: {
				passRate,
				avgTurns:
					repeats === 0
						? 0
						: runs.reduce((sum, m) => sum + m.turns, 0) / repeats,
				totalTokens: runs.reduce(
					(sum, m) => sum + m.usage.inputTokens + m.usage.outputTokens,
					0,
				),
				totalMs: runs.reduce((sum, m) => sum + m.times.totalMs, 0),
			},
		};
	}

	private push(name: string, evaluate: AssertionDef["evaluate"]): this {
		this.assertions.push({ name, evaluate });
		return this;
	}
}

/** 单入口：不加断言直接 .run() = 第一层纯采集 (input) → metrics */
export function evalCase(input: EvalInput, opts?: RunAgentOptions): EvalCaseBuilder {
	return new EvalCaseBuilder(input, opts);
}
