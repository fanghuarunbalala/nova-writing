/**
 * case → evalite 编译层（可替换壳的接缝，docs/PRD/eval-harness.md §4.2/§4.3）。
 * 规格与注册分离：`*.case.ts` 导出纯 CaseSpec（核心资产，结构自测消费）；
 * `*.eval.ts` 只做一行 defineCase 注册（evalite 在模块加载时即向 vitest 注册测试，
 * 与 vitest 常规测试流互斥——因此规格文件绝不 import 本模块）。
 * 换壳（自研 vitest / promptfoo）只改本文件与 .eval.ts 壳，case 语料不动。
 */
import { evalite } from "evalite";
import type { EvalInput, EvalRunMetrics } from "./types.js";
import { evalCase, failedMetrics, type AssertionDef, type EvalCaseBuilder } from "./dsl.js";
import { runAgent, type RunAgentOptions } from "./runner.js";

/** case 规格：name + 输入 + 断言链配置（纯数据+函数，无注册副作用） */
export interface CaseSpec {
	name: string;
	input: EvalInput;
	configure: (b: EvalCaseBuilder) => unknown;
}

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

/** 已注册 case 清单（defineCase 副作用填充；诊断/工具用，结构自测走 CaseSpec 直读） */
export interface RegisteredCase {
	name: string;
	input: EvalInput;
	builder: EvalCaseBuilder;
}

export const registeredCases: RegisteredCase[] = [];

/**
 * 在 .eval.ts 顶层调用：注册一个评测 case（data 单行 + trialCount=repeats）。
 * 返回 builder 供 .run() 单跑调试。
 */
export function defineCase(spec: CaseSpec, opts?: RunAgentOptions): EvalCaseBuilder {
	const builder = evalCase(spec.input, opts);
	spec.configure(builder);
	registeredCases.push({ name: spec.name, input: spec.input, builder });
	evalite(spec.name, {
		data: [{ input: spec.input }],
		task: async (input: EvalInput): Promise<EvalRunMetrics> => {
			try {
				return await runAgent(input, opts);
			} catch (e) {
				return failedMetrics(e);
			}
		},
		trialCount: spec.input.repeats ?? 3,
		scorers: builder.defs().map(toScorer),
	});
	return builder;
}
