/**
 * eval-harness 公共类型（docs/PRD/eval-harness.md §3）。
 * 两层接口的数据契约：EvalInput 进 → EvalRunMetrics（单次采集）→ EvalResult（断言聚合）。
 */
import type {
	AskQuestionAnswer,
	LLMessage,
	NovelMutation,
	SamplingConfig,
	ToolErrorCode,
} from "@novel/core";
import type { LibraryCallTrace, LibraryMockScript } from "./mock/engine.js";
import type { EvalGuardsSpec, GuardRule } from "./guards.js";
import type { PresetEntry } from "./preset.js";

/** 工具错误码（含事件流无法恢复确切码时的推断兜底） */
export type EvalToolErrorCode = ToolErrorCode | "UNKNOWN";

/** 评测输入（PRD §3.1 + evals-书库真实评测 F3/F4/F6 扩展） */
export interface EvalInput {
	/** 用户任务：单条消息，或多条（第二条起为 follow-up，模拟多轮指令） */
	task: string | string[];
	/** 预置状态：novel 变更序列（core NovelMutation，创建类 op）+ 工作区文件 */
	seed?: { novel?: readonly NovelMutation[]; files?: Record<string, string> };
	/** 书库 mock（F3）：夹具别名 + 可选脚本/状态覆盖；缺省不装书库（LibraryRead 降级） */
	library?: { book: string; mock?: LibraryMockScript };
	/** 执行护栏（F4）：违规即提前终止并记 abort；缺省仅预算熔断（budget）恒开 */
	guards?: EvalGuardsSpec;
	/** 预置会话史（F6）：从会话中途开始（配合 budget.maxTurns=1–5 即短跑） */
	preset?: { messages: ReadonlyArray<PresetEntry | LLMessage> };
	/** 采样覆盖；缺省 DeepSeek + temperature 0（model 可经 NOVEL_EVAL_MODEL 覆盖） */
	sampling?: Partial<SamplingConfig>;
	/** 预算：缺省 maxTurns=30、timeoutMs=300_000 */
	budget?: { maxTurns?: number; timeoutMs?: number };
	/** AskUserQuestion 应答脚本（按提问顺序消耗；耗尽后按「作者跳过」应答） */
	askScript?: readonly AskQuestionAnswer[];
	/** 审批策略：缺省 "auto" 全放行；{deny} 对含拒绝工具的批次拒绝 */
	approvals?: "auto" | { deny: readonly string[] };
	/** 重复次数：缺省 3 */
	repeats?: number;
}

/** 护栏提前终止记录（F4；带 abort 的 run 记 ok=false，负向 case 用 expectedAbort 反转） */
export interface EvalAbortInfo {
	rule: GuardRule;
	detail: string;
	/** 违规调用所在的 turn（工具批次序） */
	turn: number;
	toolCall: { name: string; argsRaw: string };
}

/** 工具失败轨迹（错误码 + 回填消息） */
export interface ToolErrorTrace {
	toolName: string;
	code: EvalToolErrorCode;
	message: string;
}

/** 单次工具调用轨迹（request/response 按 toolCallId 配对） */
export interface ToolCallTrace {
	turn: number;
	name: string;
	/** 已解析的参数（解析失败时保留原始字符串） */
	args: unknown;
	/** 原始参数 JSON 文本（matcher 的 raw 通道） */
	argsRaw: string;
	result?: string;
	error?: { code: EvalToolErrorCode; message: string };
	durationMs: number;
}

/** novel store 终态只读快照（run 后一次性物化；断言读快照而非活句柄） */
export interface NovelStoreSnapshot {
	overview: unknown;
	characters: unknown;
	locations: unknown;
	paragraphs: unknown;
	outline: unknown;
	publication: unknown;
}

/** 单次执行的完整指标（每次 repeat 产出一条） */
export interface EvalRunMetrics {
	/** 正常收尾（未超时 / 未撞 maxTurns / provider 未致命失败） */
	ok: boolean;
	/** run 级失败原因（ok=false 时） */
	error?: string;
	/** provider call 次数（= 工具批次数 + 收尾消息数，跨多消息任务累计） */
	turns: number;
	toolCalls: ToolCallTrace[];
	toolErrors: ToolErrorTrace[];
	usage: { inputTokens: number; outputTokens: number };
	times: { totalMs: number; perTurnMs: number[] };
	/** 最终 assistant 消息文本（多消息任务取最后一条） */
	final: string;
	storeSnapshot: NovelStoreSnapshot;
	/** 工作区终态文件（相对路径 → 内容） */
	files: Record<string, string>;
	/** 书库 mock 调用轨迹（启用 library 时；returnedParagraphIds = 「实际返回集合」证据链） */
	libraryCalls?: LibraryCallTrace[];
	/** 最终回复中的该书 pid 引用与其中本 run 实际返回过的（引用有效率 = valid/cited） */
	citations?: { cited: string[]; valid: string[] };
	/** 护栏提前终止（F4） */
	abort?: EvalAbortInfo;
	/** mock 脚本耗尽回退静态的次数（F3） */
	scriptExhausted?: number;
}

/** 断言 × 执行 矩阵中的一行 */
export interface AssertionReport {
	name: string;
	perRun: { run: number; passed: boolean; actual: string }[];
}

/** evalCase(...).run() 的返回 */
export interface EvalResult {
	passed: boolean;
	runs: EvalRunMetrics[];
	assertions: AssertionReport[];
	aggregate: {
		passRate: number;
		avgTurns: number;
		totalTokens: number;
		totalMs: number;
	};
}
