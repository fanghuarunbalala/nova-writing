/**
 * ConversationProjection：精简投影（客户端侧）。
 * 消费 ConversationHandle.events() 的 OutputEvent 流 → 累积 timeline 快照。
 * 替代旧 ConversationProjectionController 的复杂状态机；本期只做实时流（无 journal 重放）。
 */

import { proxy } from "kkrpc/remote-refs";
import type { ConversationHandle } from "../conversation/contract/handle/index.js";
import type { OutputEvent } from "../conversation/contract/events/index.js";
import type { ConversationId, ConversationMode } from "../conversation/contract/types/index.js";
import { CardProjection, type CardDescriptor } from "../conversation/CardProjection.js";
import { ApprovalProjection, type ApprovalView } from "../conversation/ApprovalProjection.js";
import { RPCError } from "../rpc/RPCError.js";

/** 投影状态（精简：无 replay/following 阶段） */
export type ConversationProjectionState = "idle" | "running" | "stopped" | "error";

/** timeline 项（对齐 UI 消息视图的精简子集） */
export interface ConversationTimelineItem {
	/** 角色 */
	kind: "user" | "assistant";
	/** 单调递增序号（虚拟化列表排序/去重用） */
	sequence: number;
	/** 文本内容 */
	text: string;
	/** 流式中（assistant.delta 累积期间为 true，turn-end 收口） */
	streaming?: boolean;
	/** 首事件 journal seq（cards/eventFlow/toolTraces 归属范围起点） */
	sourceSequence?: number;
	/** turn 收口 seq（工具调用常落在消息收口前；归属范围终点） */
	turnEndSequence?: number;
	/** 事件时间（turn 分隔条展示） */
	timestamp?: string;
}

/** 工具调用行（消息内工具条） */
export interface ToolTraceView {
	/** 工具调用 id（= toolCallId） */
	traceId: string;
	/** 工具名 */
	toolName: string;
	/** 阶段（终态阶段占位；core 无 stage 事件，保留兼容） */
	stage?: string;
	/** 结果 */
	outcome: "ok" | "failed";
	/** 耗时毫秒 */
	durationMs?: number;
	/** 事件 seq（归属） */
	sequence: number;
}

/** 运行时事件行（消息内「本轮时序」） */
export interface ConversationEventView {
	/** 事件 seq（归属） */
	sequence: number;
	/** 时间（epoch 毫秒） */
	timestamp: number;
	/** 事件类型（工具名） */
	eventType: string;
	/** 家族（色条分组） */
	family: "agent" | "system" | "novel" | "other";
	/** 摘要（工具结果摘要） */
	summary?: string;
	/** 终态结果 */
	outcome?: "ok" | "failed";
}

/** 投影错误快照 */
export interface ConversationProjectionErrorSnapshot {
	code: string;
	retryable: boolean;
	category: "transport" | "remote" | "unknown";
}

/** 投影快照（React useSyncExternalStore 消费，不可变） */
export interface ConversationProjectionSnapshot {
	conversationId: ConversationId;
	/** 每次发布递增（订阅方据此判定是否有新快照） */
	revision: number;
	/** 最后应用的 journal 序列号（实时 delta 无 seq，取最近 persist 事件） */
	lastAppliedSequence: number;
	state: ConversationProjectionState;
	/** 实时生成状态：text delta → generating、turn 收口 → undefined（thinking 态随 loop 层丢弃 reasoning delta 移除） */
	liveState?: "generating";
	timeline: readonly ConversationTimelineItem[];
	/** 工具调用卡片（CardProjection 派生） */
	cards: readonly CardDescriptor[];
	/** 审批视图（ApprovalProjection 派生；wait 状态唯一权威为 CMS 队列，此处保留兼容） */
	approvals: readonly ApprovalView[];
	/** 工具调用行（tool-call request/response 派生，消息内工具条） */
	toolTraces: readonly ToolTraceView[];
	/** 运行时事件行（消息内「本轮时序」） */
	eventFlow: readonly ConversationEventView[];
	/** 当前生效模式（mode.changed 权威事件派生；未收到前 undefined → UI 查询兜底） */
	mode?: ConversationMode;
	/** 待生效模式（mode.pending 瞬态事件派生；mode.changed 到达后清除） */
	modePending?: ConversationMode;
	error?: ConversationProjectionErrorSnapshot;
}

/** 订阅回调 */
export type ConversationProjectionListener = () => void;

/** history 查询注入（journal 已落盘事件重放；返回 OutputEvent 序列，无 delta） */
export type ConversationProjectionHistory = (opts: {
	fromSeq?: number;
	limit?: number;
}) => Promise<OutputEvent[]>;

/** 精简投影器：累积 OutputEvent → timeline 列表 */
export class ConversationProjection {
	private readonly conversationId: ConversationId;
	private readonly handle: ConversationHandle;
	/** history 查询（缺省空序列：纯实时流，不重放） */
	private readonly history: ConversationProjectionHistory;
	private readonly listeners = new Set<ConversationProjectionListener>();
	private timeline: ConversationTimelineItem[] = [];
	/** assistant.delta 累积缓冲 */
	private assistantBuffer = "";
	/** 当前流式 assistant 项的 sequence（无则未开始） */
	private activeAssistantSeq: number | undefined;
	/** 实时生成状态（generating；turn 收口清除） */
	private liveState: "generating" | undefined;
	private nextSeq = 1;
	private readonly cardProjection = new CardProjection();
	private readonly approvalProjection = new ApprovalProjection();
	/** 工具调用行 */
	private toolTraces: ToolTraceView[] = [];
	/** 运行时事件行 */
	private eventFlow: ConversationEventView[] = [];
	/** 当前生效模式（mode.changed 派生） */
	private mode?: ConversationMode;
	/** 待生效模式（mode.pending 派生；mode.changed 清除） */
	private modePending?: ConversationMode;
	/** 待完成的工具调用（toolCallId → 请求时间） */
	private readonly pendingTraces = new Map<string, { toolName: string; requestedAt: string; seq: number }>();
	private revision = 0;
	private lastAppliedSequence = 0;
	private state: ConversationProjectionState = "idle";
	private error?: ConversationProjectionErrorSnapshot;
	private snapshot: ConversationProjectionSnapshot;
	private generation = 0;
	private stopRequested = false;
	/** 快照子数组置脏标记（apply 置脏 → publish 时才重建冻结数组，稳定引用供 UI memo） */
	private cardsDirty = true;
	private approvalsDirty = true;
	private toolTracesDirty = true;
	private eventFlowDirty = true;
	/** 快照子数组缓存（与置脏标记成对维护） */
	private cachedCards: readonly CardDescriptor[] = [];
	private cachedApprovals: readonly ApprovalView[] = [];
	private cachedToolTraces: readonly ToolTraceView[] = [];
	private cachedEventFlow: readonly ConversationEventView[] = [];

	/**
	 * @param handle 会话对端 handle（事件流来源）
	 * @param conversationId 会话 id（快照归属）
	 * @param history journal 已落盘历史查询（恢复重放用；缺省纯实时流）
	 */
	constructor(
		handle: ConversationHandle,
		conversationId: ConversationId,
		history?: ConversationProjectionHistory,
	) {
		this.handle = handle;
		this.conversationId = conversationId;
		this.history = history ?? (async () => []);
		this.snapshot = this.buildSnapshot();
	}

	/** 当前快照（不可变） */
	getSnapshot(): ConversationProjectionSnapshot {
		return this.snapshot;
	}

	/**
	 * 订阅快照变化
	 * @param listener 变更回调
	 * @returns 取消订阅函数
	 */
	subscribe(listener: ConversationProjectionListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * 开始消费事件流（幂等：running 时直接返回）。
	 * 顺序：先订阅（缓冲）→ 拉 journal 历史应用 → 冲刷缓冲（persist 按 seq 去重、delta 由 live-turn 门控），
	 * 订阅与重放之间无丢失窗口。
	 */
	async start(): Promise<void> {
		if (this.state === "running") return;
		this.stopRequested = false;
		const generation = ++this.generation;
		this.transition("running");
		try {
			// ① 先订阅（进入缓冲模式）：listener 经 proxy() 标记——kkrpc/remote-refs 的 codec
			// 只编码 WeakSet 已标记的函数参数（内存/plain kkrpc 通道下标记是无害 no-op）
			const buffer: OutputEvent[] = [];
			let replayed = false;
			let historyMaxSeq = 0;
			await this.handle.subscribeEvents(
				proxy((event) => {
					if (this.stopRequested || generation !== this.generation) return;
					if (replayed) {
						this.apply(event);
						this.publish();
					} else {
						buffer.push(event);
					}
				}),
			);
			// ② 拉 journal 已落盘历史并应用（fromSeq 从当前进度之后开始）
			const events = await this.history({ fromSeq: this.lastAppliedSequence + 1, limit: 256 });
			if (this.stopRequested || generation !== this.generation) return;
			for (const event of events) {
				this.apply(event);
				// 状态事件（compose/mode）无 turn seq：不参与 historyMaxSeq 推进
				if ("seq" in event && typeof event.seq === "number") {
					historyMaxSeq = Math.max(historyMaxSeq, event.seq);
				}
			}
			this.publish();
			replayed = true;
			// ③ 冲刷缓冲：persist 事件仅当 seq > historyMaxSeq 才应用（历史已覆盖的去重）；
			// delta 仅当处于 live turn（seq > historyMaxSeq 的 turn-start/user.message 已开）才应用
			let liveTurn = false;
			for (const event of buffer) {
				// 状态事件（mode.pending/mode.changed）不受 liveTurn 门控：模式切换可发生在 turn 间隙
				if (event.type === "mode.pending" || event.type === "mode.changed") {
					this.apply(event);
					continue;
				}
				if ("seq" in event && event.persist) {
					// 状态事件（compose/mode）无 turn seq：不做历史去重，直接应用
					if (typeof event.seq === "number" && event.seq <= historyMaxSeq) continue;
					this.apply(event);
					if (event.type === "turn-start" || event.type === "user.message") liveTurn = true;
					else if (event.type === "turn-end") liveTurn = false;
				} else if (liveTurn) {
					this.apply(event);
				}
			}
			this.publish();
		} catch (err) {
			if (generation === this.generation && !this.stopRequested) {
				console.error("[projection.start_failed]", err);
				this.error = toErrorSnapshot(err);
				this.transition("error");
			}
		}
	}

	/** 停止消费（事件回调变 no-op；订阅由 handle.dispose 拆除） */
	async stop(): Promise<void> {
		this.stopRequested = true;
		this.generation += 1;
		if (this.state !== "stopped") this.transition("stopped");
	}

	/**
	 * 恢复：重放 journal 增量 + 重建实时订阅（fromSeq = lastAppliedSequence）。
	 * 注意：旧订阅 listener 仍注册在 handle 上（变 no-op），由 dispose 统一拆除。
	 */
	async resume(): Promise<void> {
		await this.stop();
		await this.start();
	}

	/** 应用一条 OutputEvent */
	private apply(event: OutputEvent): void {
		// 仅 persist 且带 seq 的事件推进 lastAppliedSequence（delta 瞬态无 seq；
		// compose/mode 状态事件不属 turn，seq 可选）
		if ("seq" in event && event.persist && typeof event.seq === "number") {
			this.lastAppliedSequence = event.seq;
		}
		this.cardProjection.apply(event);
		this.approvalProjection.apply(event);
		switch (event.type) {
			case "user.message":
				this.finalizeAssistant();
				this.timeline.push({
					kind: "user",
					sequence: this.nextSeq++,
					text: event.text,
					sourceSequence: event.seq,
					timestamp: event.ts,
				});
				break;
			case "assistant.message":
				// 幂等：有活跃流式项（delta 已建）→ 替换文本收口；无（journal 历史重放）→ 新推
				if (this.activeAssistantSeq !== undefined) {
					this.replaceActiveAssistant({ text: event.text, streaming: false });
					this.activeAssistantSeq = undefined;
					this.assistantBuffer = "";
					this.setTurnEndOnLast(event.seq, event.ts);
				} else {
					this.timeline.push({
						kind: "assistant",
						sequence: this.nextSeq++,
						text: event.text,
						sourceSequence: event.seq,
						turnEndSequence: event.seq,
						timestamp: event.ts,
					});
				}
				this.liveState = undefined;
				break;
			case "assistant.delta":
				// loop 层已丢弃 reasoning delta 不发送；防御旧端/异常来源：忽略不进正文
				if (event.kind === "reasoning") break;
				this.liveState = "generating";
				if (this.activeAssistantSeq === undefined) {
					this.activeAssistantSeq = this.nextSeq++;
					this.timeline.push({
						kind: "assistant",
						sequence: this.activeAssistantSeq,
						text: "",
						streaming: true,
						// 归属起点 = 当前 turn 的首个 persist seq（turn-start/user.message 已推进 lastAppliedSequence）
						sourceSequence: this.lastAppliedSequence,
					});
				}
				this.assistantBuffer += event.text;
				this.replaceActiveAssistant({ text: this.assistantBuffer });
				break;
			case "turn-end":
				this.finalizeAssistant();
				this.setTurnEndOnLast(event.seq, event.ts);
				break;
			case "tool-call-request":
				this.cardsDirty = true;
				this.eventFlowDirty = true;
				this.pendingTraces.set(event.toolCallId, {
					toolName: event.name,
					requestedAt: event.ts,
					seq: event.seq,
				});
				this.eventFlow.push({
					sequence: event.seq,
					timestamp: Date.parse(event.ts),
					eventType: event.name,
					family: familyOf(event.name),
					summary: "工具调用",
				});
				break;
			case "tool-call-response": {
				this.cardsDirty = true;
				this.toolTracesDirty = true;
				this.eventFlowDirty = true;
				const pending = this.pendingTraces.get(event.toolCallId);
				this.pendingTraces.delete(event.toolCallId);
				const failed = event.error !== undefined;
				this.toolTraces.push({
					traceId: event.toolCallId,
					toolName: pending?.toolName ?? "unknown",
					outcome: failed ? "failed" : "ok",
					...(pending !== undefined
						? { durationMs: durationBetween(pending.requestedAt, event.ts) }
						: {}),
					sequence: event.seq,
				});
				this.eventFlow.push({
					sequence: event.seq,
					timestamp: Date.parse(event.ts),
					eventType: pending?.toolName ?? "unknown",
					family: familyOf(pending?.toolName ?? ""),
					summary: failed ? "执行失败" : "执行完成",
					outcome: failed ? "failed" : "ok",
				});
				break;
			}
			case "approval.request":
			case "approval.resolved":
				// ApprovalProjection 已消费；仅置脏，快照按需重建
				this.approvalsDirty = true;
				break;
			case "mode.changed":
				// active 实际切换（权威）：落 mode + 清除待生效标记
				this.mode = event.mode;
				this.modePending = undefined;
				break;
			case "mode.pending":
				// mode.set 已记录（瞬态）：UI 回显「待生效」
				this.modePending = event.mode;
				break;
			// turn-start / compacted / clear / retry-request 无影响
		}
	}

	/** turn 收口：给最后一条 timeline 项补 turnEndSequence/timestamp（工具归属范围终点） */
	private setTurnEndOnLast(seq: number, ts: string): void {
		const last = this.timeline.at(-1);
		if (last === undefined) return;
		this.timeline[this.timeline.length - 1] = { ...last, turnEndSequence: seq, timestamp: last.timestamp ?? ts };
	}

	/** 用新字段替换当前流式 assistant 项（不可变，避免旧快照被原地改动） */
	private replaceActiveAssistant(patch: { text?: string; streaming?: boolean }): void {
		if (this.activeAssistantSeq === undefined) return;
		const idx = this.timeline.findIndex((i) => i.sequence === this.activeAssistantSeq);
		const item = this.timeline[idx];
		if (item === undefined) return;
		this.timeline[idx] = { ...item, ...patch };
	}

	/** 收口流式 assistant：streaming=false，清缓冲 */
	private finalizeAssistant(): void {
		this.liveState = undefined;
		if (this.activeAssistantSeq === undefined) return;
		this.replaceActiveAssistant({ streaming: false });
		this.activeAssistantSeq = undefined;
		this.assistantBuffer = "";
	}

	private transition(state: ConversationProjectionState): void {
		this.state = state;
		// 错误态清空 liveState，防失败后残留 generating
		if (state === "error") this.liveState = undefined;
		this.publish();
	}

	private publish(): void {
		this.revision += 1;
		this.snapshot = this.buildSnapshot();
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch {
				// 订阅方异常不影响投影
			}
		}
	}

	private buildSnapshot(): ConversationProjectionSnapshot {
		// 子数组「置脏才重建」：delta 高发路径（timeline 仅尾项变更）下其余数组保持冻结引用稳定，
		// 为 UI 层 memo 提供浅比较基础（见 docs/PRD/gui-performance.md §4.1）。
		if (this.cardsDirty) {
			this.cachedCards = Object.freeze(this.cardProjection.getCards());
			this.cardsDirty = false;
		}
		if (this.approvalsDirty) {
			this.cachedApprovals = Object.freeze(this.approvalProjection.getAll());
			this.approvalsDirty = false;
		}
		if (this.toolTracesDirty) {
			this.cachedToolTraces = Object.freeze([...this.toolTraces]);
			this.toolTracesDirty = false;
		}
		if (this.eventFlowDirty) {
			this.cachedEventFlow = Object.freeze([...this.eventFlow]);
			this.eventFlowDirty = false;
		}
		return Object.freeze({
			conversationId: this.conversationId,
			revision: this.revision,
			lastAppliedSequence: this.lastAppliedSequence,
			state: this.state,
			...(this.liveState !== undefined ? { liveState: this.liveState } : {}),
			timeline: Object.freeze([...this.timeline]),
			cards: this.cachedCards,
			approvals: this.cachedApprovals,
			toolTraces: this.cachedToolTraces,
			eventFlow: this.cachedEventFlow,
			...(this.mode !== undefined ? { mode: this.mode } : {}),
			...(this.modePending !== undefined ? { modePending: this.modePending } : {}),
			...(this.error !== undefined ? { error: this.error } : {}),
		});
	}
}

/** 工具名 → 事件家族（色条分组：novel 域 / agent 文件操作 / 其他） */
function familyOf(toolName: string): "agent" | "system" | "novel" | "other" {
	if (/^(Character|Location|Outline|Paragraph|Publication)/.test(toolName) || toolName === "NovelDelete") {
		return "novel";
	}
	if (/^(Read|Glob|Write|Edit)$/.test(toolName)) return "agent";
	return "other";
}

/** ISO 时间差（毫秒；解析失败返回 undefined） */
function durationBetween(from: string, to: string): number | undefined {
	const start = Date.parse(from);
	const end = Date.parse(to);
	if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;
	return end - start;
}

/** 把任意错误归一成投影错误快照 */
function toErrorSnapshot(err: unknown): ConversationProjectionErrorSnapshot {
	if (err instanceof RPCError) {
		const transport =
			err.code === "peer-closed" || err.code === "cancelled" || err.code === "timeout";
		return Object.freeze({
			code: err.code,
			retryable: transport,
			category: transport ? "transport" : "remote",
		});
	}
	return Object.freeze({
		code: "unknown",
		retryable: false,
		category: "unknown",
	});
}
