/**
 * ConversationProjection：精简投影（客户端侧）。
 * 消费 ConversationHandle.events() 的 OutputEvent 流 → 累积 timeline 快照。
 * 替代旧 ConversationProjectionController 的复杂状态机；本期只做实时流（无 journal 重放）。
 */

import { proxy } from "kkrpc/remote-refs";
import type { ConversationHandle } from "../conversation/contract/handle/index.js";
import type { OutputEvent } from "../conversation/contract/events/index.js";
import type { ConversationId } from "../conversation/contract/types/index.js";
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
	timeline: readonly ConversationTimelineItem[];
	/** 工具调用卡片（CardProjection 派生） */
	cards: readonly CardDescriptor[];
	/** 审批视图（ApprovalProjection 派生） */
	approvals: readonly ApprovalView[];
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
	private nextSeq = 1;
	private readonly cardProjection = new CardProjection();
	private readonly approvalProjection = new ApprovalProjection();
	private revision = 0;
	private lastAppliedSequence = 0;
	private state: ConversationProjectionState = "idle";
	private error?: ConversationProjectionErrorSnapshot;
	private snapshot: ConversationProjectionSnapshot;
	private generation = 0;
	private stopRequested = false;

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
				if ("seq" in event) historyMaxSeq = Math.max(historyMaxSeq, event.seq);
			}
			this.publish();
			replayed = true;
			// ③ 冲刷缓冲：persist 事件仅当 seq > historyMaxSeq 才应用（历史已覆盖的去重）；
			// delta 仅当处于 live turn（seq > historyMaxSeq 的 turn-start/user.message 已开）才应用
			let liveTurn = false;
			for (const event of buffer) {
				if ("seq" in event && event.persist) {
					if (event.seq <= historyMaxSeq) continue;
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
		// 仅 persist 事件推进 lastAppliedSequence（delta 瞬态不带 seq，部分实现会给 0 占位）
		if ("seq" in event && event.persist) this.lastAppliedSequence = event.seq;
		this.cardProjection.apply(event);
		this.approvalProjection.apply(event);
		switch (event.type) {
			case "user.message":
				this.finalizeAssistant();
				this.timeline.push({ kind: "user", sequence: this.nextSeq++, text: event.text });
				break;
			case "assistant.message":
				// 幂等：有活跃流式项（delta 已建）→ 替换文本收口；无（journal 历史重放）→ 新推
				if (this.activeAssistantSeq !== undefined) {
					this.replaceActiveAssistant({ text: event.text, streaming: false });
					this.activeAssistantSeq = undefined;
					this.assistantBuffer = "";
				} else {
					this.timeline.push({ kind: "assistant", sequence: this.nextSeq++, text: event.text });
				}
				break;
			case "assistant.delta":
				if (this.activeAssistantSeq === undefined) {
					this.activeAssistantSeq = this.nextSeq++;
					this.timeline.push({
						kind: "assistant",
						sequence: this.activeAssistantSeq,
						text: "",
						streaming: true,
					});
				}
				this.assistantBuffer += event.text;
				this.replaceActiveAssistant({ text: this.assistantBuffer });
				break;
			case "turn-end":
				this.finalizeAssistant();
				break;
			// turn-start / tool-call-* / compacted / clear / retry-request 对最小对话无影响
		}
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
		if (this.activeAssistantSeq === undefined) return;
		this.replaceActiveAssistant({ streaming: false });
		this.activeAssistantSeq = undefined;
		this.assistantBuffer = "";
	}

	private transition(state: ConversationProjectionState): void {
		this.state = state;
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
		return Object.freeze({
			conversationId: this.conversationId,
			revision: this.revision,
			lastAppliedSequence: this.lastAppliedSequence,
			state: this.state,
			timeline: Object.freeze([...this.timeline]),
			cards: Object.freeze(this.cardProjection.getCards()),
			approvals: Object.freeze(this.approvalProjection.getAll()),
			...(this.error !== undefined ? { error: this.error } : {}),
		});
	}
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
