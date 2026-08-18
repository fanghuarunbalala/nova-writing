/**
 * 执行护栏（docs/PRD/evals-书库真实评测.md F4）：run 内逐工具调用评估，
 * 违规即由 Runner 调 loop.stop() 提前终止并记 abort。护栏只终止与记录，
 * 与判定解耦——负向 case 可用 expectedAbort 断言「期望中的违规如期发生」。
 *
 * 缺省策略（PRD v0.3 已定）：预算熔断恒开（Runner 既有 maxTurns/timeout）；
 * allowedTools 一经声明意外工具护栏即生效；顺序/参数/循环检测默认关、case 显式开启。
 */
import { toMatcher } from "./matcher.js";
import type { ValueMatcher } from "./matcher.js";

/** 护栏规则（abort.rule 词表） */
export type GuardRule = "unexpected-tool" | "sequence" | "args" | "loop";

/** 预期工具步（tool 名 + 可选参数约束：string=contains raw，函数=ValueMatcher） */
export interface GuardToolExpect {
	tool: string;
	args?: string | ValueMatcher;
}

/** case 级护栏声明（EvalInput.guards） */
export interface EvalGuardsSpec {
	/** 声明即启用意外工具护栏：allowlist 外的工具调用立即违规 */
	allowedTools?: readonly string[];
	/**
	 * 顺序护栏：strict = 严格按序（多出的预期外调用也违规，预期耗尽后再调用违规）；
	 * loose = 期望调用须保持相对顺序（子序列），其余调用放行。缺省 strict。
	 */
	callSequence?: { expect: readonly GuardToolExpect[]; mode?: "strict" | "loose" };
	/** 参数护栏：返回违规描述（非 null）即违规；hard 语义（立即终止） */
	argsGuard?: (call: { name: string; args: unknown; argsRaw: string }) => string | null;
	/** 循环检测：连续同名同参 ≥ maxRepeats（缺省 3）即违规 */
	loopDetect?: { maxRepeats?: number };
}

/** 违规（Runner 据此 stop + 记 abort） */
export interface GuardViolation {
	rule: GuardRule;
	detail: string;
}

function expectDesc(e: GuardToolExpect): string {
	return e.args === undefined ? e.tool : `${e.tool}（含参数约束）`;
}

/** 护栏评估器（每 run 一枚；onRequest 于 tool-call-request 事件时点逐调用评估） */
export class GuardEvaluator {
	private ptr = 0;
	private lastSig: string | undefined;
	private repeatCount = 0;

	constructor(private readonly spec: EvalGuardsSpec | undefined) {}

	onRequest(call: { name: string; args: unknown; argsRaw: string }): GuardViolation | null {
		const spec = this.spec;
		if (spec === undefined) return null;

		// 循环检测（声明 loopDetect 即启用）
		if (spec.loopDetect !== undefined) {
			const sig = `${call.name}\n${call.argsRaw}`;
			this.repeatCount = sig === this.lastSig ? this.repeatCount + 1 : 1;
			this.lastSig = sig;
			if (this.repeatCount >= (spec.loopDetect.maxRepeats ?? 3)) {
				return { rule: "loop", detail: `${call.name} 连续同名同参 ${this.repeatCount} 次` };
			}
		}

		// 意外工具（声明 allowedTools 即启用）
		if (spec.allowedTools !== undefined && !spec.allowedTools.includes(call.name)) {
			return {
				rule: "unexpected-tool",
				detail: `${call.name} 不在 allowlist（${[...spec.allowedTools].join(", ")}）`,
			};
		}

		// 顺序护栏（声明 callSequence 即启用）
		if (spec.callSequence !== undefined) {
			const expect = spec.callSequence.expect;
			const mode = spec.callSequence.mode ?? "strict";
			const matches = (e: GuardToolExpect | undefined): boolean =>
				e !== undefined &&
				e.tool === call.name &&
				(e.args === undefined || toMatcher(e.args)(call.args, call.argsRaw));
			if (this.ptr >= expect.length) {
				if (mode === "strict") {
					return { rule: "sequence", detail: `预期序列已耗尽，仍调用 ${call.name}` };
				}
			} else if (matches(expect[this.ptr])) {
				this.ptr++;
			} else if (mode === "strict") {
				return {
					rule: "sequence",
					detail: `第 ${this.ptr + 1} 步预期 ${expectDesc(expect[this.ptr]!)}，实际 ${call.name}`,
				};
			} else if (expect.slice(this.ptr + 1).some((e) => matches(e))) {
				return {
					rule: "sequence",
					detail: `${call.name} 越过未完成的第 ${this.ptr + 1} 步 ${expectDesc(expect[this.ptr]!)}`,
				};
			}
		}

		// 参数护栏（声明 argsGuard 即启用）
		if (spec.argsGuard !== undefined) {
			const detail = spec.argsGuard(call);
			if (detail !== null) return { rule: "args", detail };
		}
		return null;
	}
}
