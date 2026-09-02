/**
 * ProjectionLayer：完整事件 → 投影事件（conversation 域，单一实现）。
 * live 流（Conversation 分发处）与 journal 投影读取（projectedHistory）共用本层；
 * tool-call-request/response 配对累积 → tool-recorded.started/recorded，其余事件原样透传。
 * 确定性保证：单事件驱动、无时钟/随机源、preview 纯函数 + 抛错回退默认，
 * 同一完整事件序列重投影产出一致（PRD `output-投影层` §4.2）。
 */

import type { LoopEvent } from "../../runtime/loop/types.js";
import type { ToolPreviewFn, ToolPreviewResolver } from "../../runtime/tool/previews.js";
import { defaultToolPreview, resolveToolPreview } from "../../runtime/tool/previews.js";
import type {
	AskRecordedPayload,
	ProjectedEvent,
	ToolRecordedRecordedEvent,
	ToolRecordedStartedEvent,
} from "../contract/events/index.js";
import type { AskQuestionSpec } from "../contract/types/index.js";

/** ProjectionLayer 构造选项 */
export interface ProjectionLayerOptions {
	/** preview 查询器（缺省 resolveToolPreview 纯目录） */
	resolvePreview?: ToolPreviewResolver;
}

/** 错误信息截断长度（projected 只带短信息） */
const MAX_ERROR_LENGTH = 200;

/** 未配对响应时的工具名兜底 */
const UNKNOWN_TOOL = "unknown";

/** 缺省 preview 查询器：纯目录（Main 代读路径可静态装配） */
const defaultResolver: ToolPreviewResolver = { resolvePreview: resolveToolPreview };

/** 待完成工具调用记录（request 事件字段，recorded 派生用） */
interface PendingToolCall {
	name: string;
	args: string;
	ts: string;
}

/** 投影层：完整事件流 → 投影事件流（0..1 映射、保序） */
export class ProjectionLayer {
	private readonly resolvePreview: ToolPreviewResolver;
	/** 待完成的工具调用（toolCallId → request 字段；run-end 清空） */
	private readonly pending = new Map<string, PendingToolCall>();

	/**
	 * 构造投影层
	 * @param opts 可选 preview 查询器（缺省纯目录 resolveToolPreview）
	 */
	constructor(opts?: ProjectionLayerOptions) {
		this.resolvePreview = opts?.resolvePreview ?? defaultResolver;
	}

	/**
	 * 投影一条完整事件
	 * @param event 完整事件（LoopEvent）
	 * @returns 投影事件（0 或 1 条）：tool-call 对投影为 started/recorded，其余透传
	 */
	project(event: LoopEvent): ProjectedEvent | undefined {
		switch (event.type) {
			case "tool-call-request":
				this.pending.set(event.toolCallId, { name: event.name, args: event.args, ts: event.ts });
				return this.buildStarted(event);
			case "tool-call-response": {
				const pending = this.pending.get(event.toolCallId);
				this.pending.delete(event.toolCallId);
				return this.buildRecorded(event, pending);
			}
			case "run-end":
				// run 异常收口：丢弃未配对 pending（PRD §3.3 状态机）
				this.pending.clear();
				return event;
			default:
				return event;
		}
	}

	/** tool-call-request → tool-recorded.started（preview 由层物化，字段恒在） */
	private buildStarted(request: LoopEvent & { type: "tool-call-request" }): ToolRecordedStartedEvent {
		return {
			type: "tool-recorded.started",
			seq: request.seq,
			toolCallId: request.toolCallId,
			name: request.name,
			preview: this.safePreview(request.name, { args: request.args }),
			conversationId: request.conversationId,
			...(request.agentId !== undefined ? { agentId: request.agentId } : {}),
			ts: request.ts,
		};
	}

	/** tool-call-response → tool-recorded.recorded（未配对：unknown、无 preview） */
	private buildRecorded(
		response: LoopEvent & { type: "tool-call-response" },
		pending: PendingToolCall | undefined,
	): ToolRecordedRecordedEvent {
		const failed = response.error !== undefined;
		const errorText = failed ? truncateError(response.error ?? "") : undefined;
		const recorded: ToolRecordedRecordedEvent = {
			type: "tool-recorded.recorded",
			seq: response.seq,
			toolCallId: response.toolCallId,
			name: pending?.name ?? UNKNOWN_TOOL,
			outcome: failed ? "failed" : "ok",
			...(pending !== undefined
				? {
						preview: this.safePreview(pending.name, { args: pending.args }, response),
						...(durationBetween(pending.ts, response.ts) !== undefined
							? { durationMs: durationBetween(pending.ts, response.ts) }
							: {}),
				  }
				: {}),
			...(errorText !== undefined ? { error: errorText } : {}),
			...this.buildAskPayload(pending, response),
			conversationId: response.conversationId,
			...(response.agentId !== undefined ? { agentId: response.agentId } : {}),
			ts: response.ts,
		};
		return recorded;
	}

	/** AskUserQuestion 成功作答 → 提问留影载荷（questions 取自 request args；解析失败静默省略） */
	private buildAskPayload(
		pending: PendingToolCall | undefined,
		response: LoopEvent & { type: "tool-call-response" },
	): { ask: AskRecordedPayload } | undefined {
		if (pending === undefined || pending.name !== "AskUserQuestion") return undefined;
		if (response.error !== undefined || typeof response.result !== "string") return undefined;
		try {
			const parsed = JSON.parse(pending.args) as { questions?: unknown };
			if (!Array.isArray(parsed.questions)) return undefined;
			return {
				ask: { questions: parsed.questions as readonly AskQuestionSpec[], result: response.result },
			};
		} catch {
			return undefined;
		}
	}

	/** 安全调用 preview（未注册走默认；抛错/非法值回退默认，投影流不断裂） */
	private safePreview(
		name: string,
		call: { args: string },
		response?: { result?: string; error?: string },
	): { title?: string; summary?: string; action?: string; object?: string } {
		const fallback = (): ReturnType<typeof defaultToolPreview> => defaultToolPreview(call, response, name);
		const fn: ToolPreviewFn = this.resolvePreview.resolvePreview(name) ?? fallback;
		try {
			const out = fn(call, response);
			// 非法值（非对象/数组/null）同样回退默认，保证预览内容可用
			if (typeof out !== "object" || out === null || Array.isArray(out)) {
				return fallback();
			}
			return out;
		} catch {
			return fallback();
		}
	}
}

/** ISO 时间差（毫秒；解析失败/负值返回 undefined） */
function durationBetween(from: string, to: string): number | undefined {
	const start = Date.parse(from);
	const end = Date.parse(to);
	if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;
	return end - start;
}

/** 错误短信息截断（非完整 error，≤200 字符） */
function truncateError(error: string): string {
	return error.length > MAX_ERROR_LENGTH ? `${error.slice(0, MAX_ERROR_LENGTH)}…` : error;
}
