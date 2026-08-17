/**
 * case → evalite 编译层（可替换壳的接缝，docs/PRD/eval-harness.md §4.2/§4.3）：
 * data 单行 + trialCount=repeats（evalite 原生重复采样，trialIndex 落结果）；
 * task = Runner（返回 EvalRunMetrics，抛错落兜底 metrics）；
 * scorer = 断言编译（ScorerOpts：{score: 0|1, metadata: {actual}}）。
 * 换壳（自研 vitest / promptfoo）只改本文件，case 语料与 DSL 不动。
 */
import { evalite } from "evalite";
import type { EvalInput, EvalRunMetrics } from "./types.js";
import { evalCase, failedMetrics, type AssertionDef, type EvalCaseBuilder } from "./dsl.js";
import { runAgent, type RunAgentOptions } from "./runner.js";

function toScorer(def: AssertionDef) {
	return {
		name: def.name,
		scorer: async ({ output }: { output: EvalRunMetrics }) => {
			try {
				const verdict = await def.evaluate(output);
				return { score: verdict.passed ? 1 : 0, metadata: { actual: verdict.actual } };
			} catch (e) {
				return {
					score: 0,
					metadata: {
						actual: `断言执行出错：${e instanceof Error ? e.message : String(e)}`,
					},
				};
			}
		},
	};
}

/**
 * 在 .eval.ts 顶层调用：注册一个评测 case。
 * 断言链在 configure 回调内完成（evalite 注册前定型），返回 builder 供 .run() 单跑调试。
 */
export function defineCase(
	name: string,
	input: EvalInput,
	configure: (b: EvalCaseBuilder) => unknown,
	opts?: RunAgentOptions,
): EvalCaseBuilder {
	const builder = evalCase(input, opts);
	configure(builder);
	evalite(name, {
		data: [{ input }],
		task: async (input: EvalInput): Promise<EvalRunMetrics> => {
			try {
				return await runAgent(input, opts);
			} catch (e) {
				return failedMetrics(e);
			}
		},
		trialCount: input.repeats ?? 3,
		scorers: builder.defs().map(toScorer),
	});
	return builder;
}
