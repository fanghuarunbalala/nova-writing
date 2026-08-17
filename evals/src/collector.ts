/**
 * 指标采集：LoopEvent → 原始事件日志 → 归约为 turns / toolCalls / toolErrors / perTurnMs。
 *
 * turn 语义（docs/architecture.md）：一次 provider call。事件流无显式 turn 边界——
 * 中间 turn（带 tool_call）只发 tool-call-request/response，收尾 turn 才发 assistant.message，
 * 因此 turn 划分 = 工具批次（连续 request 起始新批）+ 每条 assistant.message 各占一 turn。
 *
 * 错误码双通道：handler 路径事件只带 error 文本（码仅在模型可见文案里）；precheck 路径
 * 以 result 文本「预检未通过(TOOL_XXX): …」返回。前者按 args 可解析性 / 工具名在册推断码。
 */
import type { LoopEvent } from "@novel/core";
import type { EvalToolErrorCode, ToolCallTrace, ToolErrorTrace } from "./types.js";

type Rec =
	| { kind: "run-start"; at: number }
	| { kind: "user.message"; at: number }
	| { kind: "assistant.message"; at: number }
	| {
			kind: "tool-call-request";
			at: number;
			toolCallId: string;
			name: string;
			args: string;
	  }
	| {
			kind: "tool-call-response";
			at: number;
			toolCallId: string;
			result?: string;
			error?: string;
	  };

/** 事件流订阅端：过滤入指标的事件，按到达序记录（到达时间即计时信号） */
export class MetricsCollector {
	readonly records: Rec[] = [];

	push(e: LoopEvent, at: number = Date.now()): void {
		switch (e.type) {
			case "run-start":
			case "user.message":
			case "assistant.message":
				this.records.push({ kind: e.type, at });
				break;
			case "tool-call-request":
				this.records.push({
					kind: "tool-call-request",
					at,
					toolCallId: e.toolCallId,
					name: e.name,
					args: e.args,
				});
				break;
			case "tool-call-response":
				this.records.push({
					kind: "tool-call-response",
					at,
					toolCallId: e.toolCallId,
					...(e.result !== undefined ? { result: e.result } : {}),
					...(e.error !== undefined ? { error: e.error } : {}),
				});
				break;
			default:
				// assistant.delta / compacted 等不入指标
				break;
		}
	}
}

/** precheck 失败的 result 文本前缀（core novel 工具 precheck 回填格式） */
const PRECHECK_RE = /^预检未通过\((TOOL_[A-Z_]+)\)[:：]?\s*([\s\S]*)$/;

/** handler 路径错误码推断：事件不带码，按 args 合法性 / 工具名在册还原 */
function inferErrorCode(name: string, argsRaw: string, knownToolNames: ReadonlySet<string>): EvalToolErrorCode {
	if (knownToolNames.size > 0 && !knownToolNames.has(name)) return "TOOL_NOT_AVAILABLE";
	try {
		JSON.parse(argsRaw);
		return "TOOL_HANDLER_FAILED";
	} catch {
		return "TOOL_ARGUMENTS_INVALID";
	}
}

function parseArgs(raw: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return raw;
	}
}

/** 归约：turn 划分 + request/response 配对 + 错误双通道提取 */
export function reduceMetrics(
	records: readonly Rec[],
	knownToolNames: ReadonlySet<string>,
): {
	turns: number;
	perTurnMs: number[];
	toolCalls: ToolCallTrace[];
	toolErrors: ToolErrorTrace[];
} {
	// ① turn 单元划分：新批次 = request 且前一事件不是 request；assistant.message 独占一单元
	interface Unit {
		startAt: number;
		endAt: number;
		requests: Extract<Rec, { kind: "tool-call-request" }>[];
		responses: Extract<Rec, { kind: "tool-call-response" }>[];
		final: boolean;
	}
	const units: Unit[] = [];
	let conversationStartAt: number | undefined;
	let prevKind: string | undefined;
	for (const rec of records) {
		if (rec.kind === "run-start" || rec.kind === "user.message") {
			conversationStartAt ??= rec.at;
			prevKind = rec.kind;
			continue;
		}
		const isNewBatch =
			rec.kind === "tool-call-request" && prevKind !== "tool-call-request";
		if (isNewBatch || rec.kind === "assistant.message") {
			units.push({
				startAt: rec.at,
				endAt: rec.at,
				requests: [],
				responses: [],
				final: rec.kind === "assistant.message",
			});
		}
		const unit = units[units.length - 1];
		if (unit === undefined) continue; // 理论不可达（response 必有 request 前导）
		if (rec.kind === "tool-call-request") unit.requests.push(rec);
		else if (rec.kind === "tool-call-response") unit.responses.push(rec);
		unit.endAt = rec.at;
		prevKind = rec.kind;
	}

	// ② perTurn 时长：turn i 起点 = 上一单元终点（首单元 = 会话首事件）
	const perTurnMs = units.map((u, i) => {
		const startAt = i === 0 ? (conversationStartAt ?? u.startAt) : units[i - 1]!.endAt;
		return Math.max(0, u.endAt - startAt);
	});

	// ③ 配对与错误提取
	const toolCalls: ToolCallTrace[] = [];
	const toolErrors: ToolErrorTrace[] = [];
	units.forEach((unit, unitIndex) => {
		const byId = new Map(unit.responses.map((r) => [r.toolCallId, r]));
		for (const req of unit.requests) {
			const res = byId.get(req.toolCallId);
			const trace: ToolCallTrace = {
				turn: unitIndex + 1,
				name: req.name,
				args: parseArgs(req.args),
				argsRaw: req.args,
				durationMs: res ? Math.max(0, res.at - req.at) : 0,
				...(res?.result !== undefined ? { result: res.result } : {}),
			};
			if (res !== undefined) {
				if (res.error !== undefined) {
					const code = inferErrorCode(req.name, req.args, knownToolNames);
					trace.error = { code, message: res.error };
					toolErrors.push({ toolName: req.name, code, message: res.error });
				} else if (res.result !== undefined) {
					const precheck = PRECHECK_RE.exec(res.result);
					if (precheck !== null) {
						const code = precheck[1] as EvalToolErrorCode;
						const message = precheck[2] ?? res.result;
						trace.error = { code, message };
						toolErrors.push({ toolName: req.name, code, message });
					}
				}
			}
			toolCalls.push(trace);
		}
	});

	return { turns: units.length, perTurnMs, toolCalls, toolErrors };
}
