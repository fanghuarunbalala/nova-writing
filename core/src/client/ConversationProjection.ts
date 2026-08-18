/**
 * ConversationProjection：精简投影（客户端侧）。
 * 消费 ConversationHandle.subscribeEvents 的 ProjectedEvent 流 → 累积 timeline 快照。
 * assistant 项按正文片段分段：每段 = 内容片段 + 其后的工具行批次（无正文间隔的
 * 连续工具行并组，demo .toolGroup 单盒多行；见 docs/design/app-redesign-demo.html）；
 * 工具行承载 preview（action/object/title/summary）。
 */

import { proxy } from "kkrpc/remote-refs";
import type { ConversationHandle } from "../conversation/contract/handle/index.js";
import type { AskRecordedPayload, ProjectedEvent, ToolPreview } from "../conversation/contract/events/index.js";
import type { ConversationId, ConversationMode } from "../conversation/contract/types/index.js";
import { CardProjection, type CardDescriptor } from "../conversation/CardProjection.js";
import { RPCError } from "../rpc/RPCError.js";

/** delta 高发路径的合并发布窗口（ms）：置脏 → 32ms 尾沿才 join/拷贝/发布（gui-performance-2 功能点三） */
const DIRTY_PUBLISH_MS = 32;

/** 投影状态（精简：无 replay/following 阶段） */
export type ConversationProjectionState = "idle" | "running" | "stopped" | "error";

/** 工具调用行（turn 分段内的单行工具条目） */
export interface ToolTraceView {
	/** 工具调用 id（= toolCallId） */
	traceId: string;
	/** 工具名 */
	toolName: string;
	/** 结果（undefined = 进行中；tool-recorded.recorded 恒带值） */
	outcome?: "ok" | "failed";
	/** 耗时毫秒 */
	durationMs?: number;
	/** 开始时间（epoch 毫秒；UI 进行中实时秒数推算） */
	startedAt?: number;
	/** 事件 seq（归属） */
	sequence: number;
	/** 投影预览（action/object/title/summary；UI 组合动作标识命名） */
	preview?: ToolPreview;
	/** AskUserQuestion 留影载荷（成功作答的 recorded 事件携带；UI 内联渲染在工具行旁） */
	ask?: AskRecordedPayload;
}

	/** assistant 消息的一个分段：内容片段 + 其后的工具行批次 */
	export interface AssistantSegment {
		/** 本段内容片段（live 按 delta 切段；重放形态为空） */
		text: string;
		/** 本批工具行（进行中/完成/失败；无正文间隔的连续调用并组） */
		tools: readonly ToolTraceView[];
	}

/** timeline 项（对齐 UI 消息视图的精简子集） */
export interface ConversationTimelineItem {
	/** 角色 */
	kind: "user" | "assistant";
	/** 单调递增序号（虚拟化列表排序/去重用） */
	sequence: number;
	/** 完整文本（markdown 渲染；live 为分段拼接，重放为完整消息） */
	text: string;
	/** assistant 专用：正文分段（每段 = 内容片段 + 其后工具批次；无工具调用时为空数组） */
	segments?: readonly AssistantSegment[];
	/** 流式中（assistant.delta 累积期间为 true，run-end 收口） */
	streaming?: boolean;
	/** 首事件 journal seq（cards 归属范围起点） */
	sourceSequence?: number;
	/** run 收口 seq（工具调用常落在消息收口前；归属范围终点） */
	runEndSequence?: number;
	/** 事件时间（run 分隔条展示） */
	timestamp?: string;
	/** 建项时生效模式（头部 chip 展示；按 mode.changed 在 assistant 建项点盖章） */
	mode?: ConversationMode;
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
	/**
	 * 实时生成状态：run-start/思考心跳 → thinking、text delta → generating、run 收口 → undefined。
	 * thinking 期 UI 显示「深度思考中」（thinkingChars 为 reasoning 心跳累计字符数）。
	 */
	liveState?: "thinking" | "generating";
	/** 思考累计字符数（liveState="thinking" 期间存在；正文开始即清除） */
	thinkingChars?: number;
	timeline: readonly ConversationTimelineItem[];
	/** 工具调用卡片（CardProjection 派生） */
	cards: readonly CardDescriptor[];
	/** 当前生效模式（mode.changed 权威事件派生；未收到前 undefined → UI 查询兜底） */
	mode?: ConversationMode;
	/** 待生效模式（mode.pending 瞬态事件派生；mode.changed 到达后清除） */
	modePending?: ConversationMode;
	error?: ConversationProjectionErrorSnapshot;
}

/** 订阅回调 */
export type ConversationProjectionListener = () => void;

/** history 查询注入（journal 投影读取重放；返回 ProjectedEvent 序列，与实时订阅同形态） */
export type ConversationProjectionHistory = (opts: {
	fromSeq?: number;
	limit?: number;
}) => Promise<ProjectedEvent[]>;

/**
 * 平台事件源（gui-performance-2 功能点八）：Electron ZMQ 推送通道的 renderer 侧
 * 形态（main 裸 IPC 转发，无 kkrpc 往返）。注入时优先于 handle.subscribeEvents
 * （fire-and-forget，丢包由 eseq 断档 + history 重放自愈）；缺省回退 kkrpc 订阅。
 */
export interface ConversationPlatformEventSource {
	/** 订阅指定会话的实时事件；返回取消订阅函数 */
	subscribe(conversationId: string, listener: (event: ProjectedEvent) => void): () => void;
}

/** 精简投影器：累积 ProjectedEvent → timeline 列表 */
export class ConversationProjection {
	private readonly conversationId: ConversationId;
	private readonly handle: ConversationHandle;
	/** history 查询（缺省空序列：纯实时流，不重放） */
	private readonly history: ConversationProjectionHistory;
	private readonly listeners = new Set<ConversationProjectionListener>();
	private timeline: ConversationTimelineItem[] = [];
	/** 当前流式 assistant 项的 sequence（无则未开始） */
	private activeAssistantSeq: number | undefined;
	/** 当前流式 assistant 项的分段（可变工作区，收口时冻结进项） */
	private activeSegments: AssistantSegment[] = [];
	/** 当前段 delta 累积缓冲（assistant.delta 追加） */
	private activeSegmentText = "";
	/**
	 * 续句合并进行中：上一请求文本无句读结尾（半句被工具调用/审批打断），
	 * 新请求文本持续并入上一段（正文不在句中断裂）。工具行再开段/收口时解除。
	 */
	private continuingIntoLastSegment = false;
	/** 自上一工具批次以来累积的正文（assistant.message 幂等去重/补尾/修正判定基准） */
	private textSinceLastTool = "";
	/** canonical 修正全文（assistant.message 与已流式文本存在细微差异时暂存，收口优先采用） */
	private pendingFullText: string | undefined;
	/** 实时生成状态（run-start/思考心跳 → thinking、text delta → generating；run 收口清除） */
	private liveState: "thinking" | "generating" | undefined;
	/** 思考累计字符数（reasoning 心跳更新；正文开始/收口清除） */
	private thinkingChars?: number;
	/** history 重放进行中（start() ② 段）：run-start 不据此置 generating——
	 *  防中断 run 的 journal 重放后永久卡在「正在生成」；实时/缓冲冲刷路径不置位 */
	private replayingHistory = false;
	private nextSeq = 1;
	private readonly cardProjection = new CardProjection();
	/** 已携带 ask 留影载荷的工具调用 id（实时流与 history 重放重叠时去重） */
	private readonly askRecordIds = new Set<string>();
	/** 当前生效模式（mode.changed 派生） */
	private mode?: ConversationMode;
	/** 待生效模式（mode.pending 派生；mode.changed 清除） */
	private modePending?: ConversationMode;
	private revision = 0;
	private lastAppliedSequence = 0;
	private state: ConversationProjectionState = "idle";
	private error?: ConversationProjectionErrorSnapshot;
	private snapshot: ConversationProjectionSnapshot;
	private generation = 0;
	private stopRequested = false;
	/** 快照子数组置脏标记（apply 置脏 → publish 时才重建冻结数组，稳定引用供 UI memo） */
	private cardsDirty = true;
	/** 快照子数组缓存（与置脏标记成对维护） */
	private cachedCards: readonly CardDescriptor[] = [];
	/** 活跃 assistant 项脏标记（delta 置脏 → publish 前才 join/重建项对象） */
	private activeItemDirty = false;
	/** 活跃 assistant 项的 timeline 索引缓存（push 后为尾项；校验失配才回退线性查找） */
	private activeIndex = -1;
	/** 合并发布定时器（32ms 尾沿；窗口内重复 delta 幂等并入） */
	private publishTimer: ReturnType<typeof setTimeout> | undefined;
	/** 平台事件源（ZMQ 推送通道；缺省回退 handle.subscribeEvents） */
	private readonly eventSource?: ConversationPlatformEventSource;
	/** 平台事件源取消订阅（stop 时拆除，避免 resume 叠加监听） */
	private unsubscribePlatformEvents?: () => void;
	/** 最近收到的实时事件 eseq（断档检测基线；history 重放事件无 eseq 不参与） */
	private lastEseq: number | undefined;
	/** eseq 断档补拉在途标记（并发断档只触发一次 catch-up） */
	private catchUpInFlight = false;

	/**
	 * @param handle 会话对端 handle（事件流来源）
	 * @param conversationId 会话 id（快照归属）
	 * @param history journal 已落盘历史查询（恢复重放用；缺省纯实时流）
	 * @param eventSource 平台事件源（ZMQ 推送；缺省回退 kkrpc subscribeEvents）
	 */
	constructor(
		handle: ConversationHandle,
		conversationId: ConversationId,
		history?: ConversationProjectionHistory,
		eventSource?: ConversationPlatformEventSource,
	) {
		this.handle = handle;
		this.conversationId = conversationId;
		this.history = history ?? (async () => []);
		this.eventSource = eventSource;
		this.snapshot = this.buildSnapshot();
	}

	/** 当前快照（不可变；读到脏文本时先冲刷——读取方永远看到含最新 delta 的视图） */
	getSnapshot(): ConversationProjectionSnapshot {
		if (this.activeItemDirty) {
			this.activeItemDirty = false;
			this.syncActiveItem();
			this.revision += 1;
			this.snapshot = this.buildSnapshot();
		}
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
	 * 顺序：先订阅（缓冲）→ 拉 journal 历史应用 → 冲刷缓冲（带 seq 按 seq 去重、delta 由 live-run 门控），
	 * 订阅与重放之间无丢失窗口。
	 */
	async start(): Promise<void> {
		if (this.state === "running") return;
		this.stopRequested = false;
		const generation = ++this.generation;
		this.transition("running");
		try {
			// ① 先订阅（进入缓冲模式）：平台事件源（ZMQ 推送，同步订阅）或
			// kkrpc subscribeEvents（listener 经 proxy() 标记——kkrpc/remote-refs 的 codec
			// 只编码 WeakSet 已标记的函数参数；内存/plain kkrpc 通道下标记是无害 no-op）
			const buffer: ProjectedEvent[] = [];
			let replayed = false;
			let historyMaxSeq = 0;
			const onEvent = (event: ProjectedEvent): void => {
				if (this.stopRequested || generation !== this.generation) return;
				if (replayed) {
					this.apply(event);
					// delta 经 32ms 合并窗口发布（apply 置脏）；其余事件立即发布
					// （publish 前会冲刷脏文本，保证顺序一致）
					if (event.type !== "assistant.delta") this.publish();
				} else {
					buffer.push(event);
				}
			};
			if (this.eventSource !== undefined) {
				this.unsubscribePlatformEvents = this.eventSource.subscribe(this.conversationId, onEvent);
			} else {
				await this.handle.subscribeEvents(proxy(onEvent));
			}
			// ② 拉 journal 已落盘历史并应用（fromSeq 从当前进度之后开始）
			const events = await this.history({ fromSeq: this.lastAppliedSequence + 1, limit: 256 });
			if (this.stopRequested || generation !== this.generation) return;
			this.replayingHistory = true;
			try {
				for (const event of events) {
					this.apply(event);
					// 状态事件（compose/mode）无 turn seq：不参与 historyMaxSeq 推进
					if ("seq" in event && typeof event.seq === "number") {
						historyMaxSeq = Math.max(historyMaxSeq, event.seq);
					}
				}
			} finally {
				this.replayingHistory = false;
			}
			this.publish();
			replayed = true;
			// ③ 冲刷缓冲：带 seq 事件仅当 seq > historyMaxSeq 才应用（历史已覆盖的去重）；
			// delta（无 seq）仅当处于 live run（seq > historyMaxSeq 的 run-start/user.message 已开）才应用
			let liveRun = false;
			for (const event of buffer) {
				// 状态事件（mode.pending/mode.changed）不受 liveRun 门控：模式切换可发生在 run 间隙
				if (event.type === "mode.pending" || event.type === "mode.changed") {
					this.apply(event);
					continue;
				}
				if ("seq" in event && typeof event.seq === "number") {
					if (event.seq <= historyMaxSeq) continue;
					this.apply(event);
					if (event.type === "run-start" || event.type === "user.message") liveRun = true;
					else if (event.type === "run-end") liveRun = false;
				} else if (liveRun) {
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

	/** 停止消费（事件回调变 no-op；平台事件源订阅拆除，kkrpc 订阅由 handle.dispose 拆除） */
	async stop(): Promise<void> {
		this.stopRequested = true;
		this.generation += 1;
		if (this.publishTimer !== undefined) {
			clearTimeout(this.publishTimer);
			this.publishTimer = undefined;
		}
		this.unsubscribePlatformEvents?.();
		this.unsubscribePlatformEvents = undefined;
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

	/** 应用一条 ProjectedEvent */
	private apply(event: ProjectedEvent): void {
		// subagent 隔离：盖章即 subagent（agentId = "<agentType>:<taskId>"），
		// 非 main 事件不进主流时间线（未盖章与 "main" 视为主流；任务快照走 queryTasks）
		if (event.agentId !== undefined && event.agentId !== "main") return;
		// eseq 断档检测（ZMQ fire-and-forget 丢包自愈：触发 history 补拉；
		// history 重放事件无 eseq，不参与基线——首个实时事件建立基线）
		const eseq = (event as { eseq?: number }).eseq;
		if (typeof eseq === "number") {
			if (this.lastEseq !== undefined && eseq > this.lastEseq + 1) this.scheduleCatchUp();
			this.lastEseq = Math.max(this.lastEseq ?? 0, eseq);
		}
		// 仅带 seq 事件推进 lastAppliedSequence（delta 瞬态不带 seq；compose/mode 状态事件 seq 可选）
		if ("seq" in event && typeof event.seq === "number") {
			this.lastAppliedSequence = event.seq;
		}
		this.cardProjection.apply(event);
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
			case "assistant.message": {
				// 轮文本（不收口：收口统一由 run-end/user.message 边界触发，assistant.message
				// 只承载文本）。以「自上一工具批次以来的文本」（本轮已流式部分）为基准：
				// live 已流式 → 幂等去重；delta 丢包 → 前缀补尾；重放（无 delta）→ 整段
				// 补进正文分段，工具组与各轮文本按出现顺序交错（不拆多消息、不错位配对）；
				// canonical 修正（本轮已流式但与最终文本有细微差异）→ 不追加（避免重复），
				// 存为权威全文，收口时优先采用。
				this.ensureActiveAssistant(event);
				const messageText = event.text ?? "";
				const streamed = this.textSinceLastTool;
				if (!streamed.endsWith(messageText)) {
					if (streamed !== "" && messageText.startsWith(streamed)) {
						this.appendAssistantText(messageText.slice(streamed.length));
					} else if (streamed === "") {
						if (messageText !== "") this.appendAssistantText(messageText);
					} else {
						this.pendingFullText = messageText;
					}
				}
				this.liveState = undefined;
				this.thinkingChars = undefined;
				this.activeItemDirty = true;
				this.publish();
				break;
		}
			case "assistant.delta": {
				// 思考心跳（kind:"reasoning"，text 恒空无内容）：驱动 thinking 态 + 字符计数，
				// 不进正文（gui-performance 一期的「思考内容不上链」决策不变）
				if (event.kind === "reasoning") {
					if (typeof event.chars === "number" && event.chars > 0) {
						this.thinkingChars = event.chars;
					}
					this.liveState = "thinking";
					this.publish();
					break;
				}
				this.liveState = "generating";
				this.thinkingChars = undefined;
				this.ensureActiveAssistant(event);
				this.appendAssistantText(event.text);
				// 置脏 + 合并发布（gui-performance-2 功能点三）：单条 delta 成本 = 一次追加 + 置位，
				// 全文 join / segments 重建 / timeline 拷贝挪到 32ms 发布窗口（或下一次立即 publish 前）
				this.activeItemDirty = true;
				this.scheduleDirtyPublish();
				break;
			}
			case "tool-recorded.started":
				this.ensureActiveAssistant(event);
				if (this.segmentIsClosed()) this.openSegment();
				this.pushToolRow({
					traceId: event.toolCallId,
					toolName: event.name,
					startedAt: Date.parse(event.ts),
					sequence: event.seq,
					preview: event.preview,
				});
				this.syncActiveItem();
				break;
			case "tool-recorded.recorded": {
				this.ensureActiveAssistant(event);
				// AskUserQuestion 留影载荷挂到所属工具行（UI 内联渲染在工具行旁，
				// 位置随段结构精确；journal 重放同路径）。带 ask 的重复 recorded
				// （实时流与 history 重放重叠）→ 幂等跳过：工具行已是终态且已携带载荷。
				if (event.ask !== undefined) {
					if (this.askRecordIds.has(event.toolCallId)) break;
					this.askRecordIds.add(event.toolCallId);
				}
				this.replaceToolRow({
					traceId: event.toolCallId,
					toolName: event.name,
					outcome: event.outcome,
					durationMs: event.durationMs,
					sequence: event.seq,
					preview: event.preview,
					...(event.ask !== undefined ? { ask: event.ask } : {}),
				});
				this.syncActiveItem();
				break;
			}
			case "run-end":
				this.finalizeAssistant();
				this.setRunEndOnLast(event.seq, event.ts);
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
			case "run-start":
				// run 开跑即进入 thinking（上下文组装 + 模型 TTFT/推理期间状态行就绪）；
				// 首个 text delta 切 generating。history 重放不置位（replayingHistory 守卫）。
				// 清除：run-end / assistant.message 收口、error 态。
				if (!this.replayingHistory) {
					this.liveState = "thinking";
					this.publish();
				}
				break;
			// compacted / clear / retry-request / compose.* 无影响
		}
	}

	/** 确保存在活跃 assistant 项（live 首个 delta / 重放首个 tool-recorded 时创建） */
	private ensureActiveAssistant(event: ProjectedEvent): void {
		if (this.activeAssistantSeq !== undefined) return;
		this.activeAssistantSeq = this.nextSeq++;
		this.activeSegments = [];
		this.activeSegmentText = "";
		this.timeline.push({
			kind: "assistant",
			sequence: this.activeAssistantSeq,
			text: "",
			segments: [],
			streaming: true,
			// 归属起点 = 当前 run 的首个 persist seq（run-start/user.message 已推进 lastAppliedSequence）
			sourceSequence: this.lastAppliedSequence,
			...(this.mode !== undefined ? { mode: this.mode } : {}),
			...(typeof event.ts === "string" ? { timestamp: event.ts } : {}),
		});
		this.activeIndex = this.timeline.length - 1;
	}

	/**
	 * 追加 assistant 正文（delta 与 assistant.message 共用）：
	 * 上一段已收口工具行 → 新请求的内容：句读收尾开新段（段间换行分隔）；
	 * 半句被工具调用/审批打断（无句读结尾）→ 续句并入上一段，正文不在句中断裂。
	 */
	private appendAssistantText(text: string): void {
		if (this.segmentIsClosed()) {
			if (!this.continuingIntoLastSegment && this.lastSegmentAcceptsContinuation()) {
				this.continuingIntoLastSegment = true;
			}
			// 不接受续句：正文在未封缓冲累积为新段（syncActiveItem 以尾段渲染）。
			// 不得在此 openSegment()——closed 态每条 delta 都会重入本分支，
			// 首条 delta 的文本块会被提前封成独立 segment，续流正文在 delta
			// 边界（可能在词中间）被拆成两段，渲染成「断字换行」形态。
		}
		if (this.continuingIntoLastSegment) {
			this.appendToLastSegment(text);
		} else {
			this.activeSegmentText += text;
		}
		this.textSinceLastTool += text;
	}

	/** 把工作区（已封段 + 当前缓冲）同步进 timeline 项对象（publish 前调用：脏文本落快照）。
	 *  未封缓冲以尾段（纯文本段）并入 segments：段文本拼接恒等于 item.text，
	 *  UI 交错渲染形态在流式期间稳定（不因缓冲未封而回退堆叠形态）。 */
	private syncActiveItem(): void {
		if (this.activeAssistantSeq === undefined) return;
		const idx = this.activeIndexResolved();
		if (idx < 0) return;
		const item = this.timeline[idx]!;
		const segments = Object.freeze([
			...this.activeSegments.map((s) => Object.freeze({ text: s.text, tools: Object.freeze([...s.tools]) })),
			...(this.activeSegmentText !== "" ? [Object.freeze({ text: this.activeSegmentText, tools: Object.freeze([]) })] : []),
		]);
		this.timeline[idx] = {
			...item,
			text: this.activeSegments.map((s) => s.text).join("") + this.activeSegmentText,
			segments,
		};
	}

	/** 活跃项 timeline 索引（缓存命中免逐次线性扫描；失配回退 findIndex） */
	private activeIndexResolved(): number {
		if (this.timeline[this.activeIndex]?.sequence === this.activeAssistantSeq) return this.activeIndex;
		this.activeIndex = this.timeline.findIndex((i) => i.sequence === this.activeAssistantSeq);
		return this.activeIndex;
	}

	/** 当前段是否已收口（最后工具行已有结果）→ 后续正文开新段（连续工具行仍并组） */
	private segmentIsClosed(): boolean {
		const last = this.activeSegments.at(-1);
		if (last === undefined || last.tools.length === 0) return false;
		const lastTool = last.tools.at(-1);
		return lastTool !== undefined && lastTool.outcome !== undefined;
	}

	/** 开新段（把当前缓冲封进上一段，重置缓冲；续句合并解除） */
	private openSegment(): void {
		this.continuingIntoLastSegment = false;
		this.pushSegment(this.activeSegmentText);
		this.activeSegmentText = "";
	}

	/** 句读结尾判定（续句合并边界）：以句末标点/换行收尾视为完整句，允许分段换行 */
	private static readonly SENTENCE_END = /[。！？…!?;；:：\n\r]$/;

	/** 上一段是否接受续句合并：文本非空且未以句读收尾（半句被工具调用打断） */
	private lastSegmentAcceptsContinuation(): boolean {
		const last = this.activeSegments.at(-1);
		if (last === undefined) return false;
		const text = last.text.trimEnd();
		if (text === "") return false;
		return !ConversationProjection.SENTENCE_END.test(text);
	}

	/** 续句文本并入上一段（工具行归属该段，渲染在其下方） */
	private appendToLastSegment(text: string): void {
		const last = this.activeSegments[this.activeSegments.length - 1];
		if (last === undefined) {
			this.activeSegmentText += text;
			return;
		}
		this.activeSegments[this.activeSegments.length - 1] = {
			text: last.text + text,
			tools: last.tools,
		};
	}

	/** 把当前缓冲封进 activeSegments（缓冲为空且段无工具时跳过） */
	private pushSegment(text: string): void {
		if (text === "") return;
		this.activeSegments.push({ text, tools: [] });
	}

	/** 当前段追加工具行（started：进行中）；先封存缓冲中的 delta 内容（工具行属于当前段）；续句合并解除（工具行再开段，其后文本重新起段） */
	private pushToolRow(row: ToolTraceView): void {
		this.continuingIntoLastSegment = false;
		this.textSinceLastTool = "";
		this.pushSegment(this.activeSegmentText);
		this.activeSegmentText = "";
		const last = this.activeSegments.at(-1);
		if (last === undefined) {
			this.activeSegments.push({ text: "", tools: [row] });
			return;
		}
		// 上一段已收口且无正文间隔（缓冲为空、未封存文本段）→ 并入上一段：
		// 无正文间隔的连续工具行同组（demo .toolGroup 单盒多行）；正文出现才开新段。
		// 无显式请求边界事件，「新请求直接开工具（无正文）」与此场景不可区分，一并并组。
		this.activeSegments[this.activeSegments.length - 1] = { text: last.text, tools: [...last.tools, row] };
	}

	/** 按 traceId 替换当前项内的工具行（从后往前找，同 id 原位幂等替换——实时流与
	 *  history 重放重叠时不追加重复行；找不到则追加新段） */
	private replaceToolRow(row: ToolTraceView): void {
		for (let i = this.activeSegments.length - 1; i >= 0; i--) {
			const seg = this.activeSegments[i]!;
			const idx = seg.tools.findIndex((t) => t.traceId === row.traceId);
			if (idx < 0) continue;
			const tools = [...seg.tools];
			tools[idx] = row;
			this.activeSegments[i] = { text: seg.text, tools };
			return;
		}
		this.pushToolRow(row);
	}

	/**
	 * 收口流式 assistant：segments 冻结进项、streaming=false、清工作区。
	 * 文本优先级：canonical 修正全文 > 分段拼接（live delta 与重放轮文本都落在段里）
	 * > 既有项文本。
	 */
	private finalizeAssistant(): void {
		this.liveState = undefined;
		this.thinkingChars = undefined;
		if (this.activeAssistantSeq === undefined) return;
		const idx = this.activeIndexResolved();
		const item = this.timeline[idx];
		if (item === undefined) {
			this.resetActiveAssistant();
			return;
		}
		// 收口时把剩余缓冲封段（空缓冲且无工具行则丢弃）
		if (this.activeSegmentText !== "" || this.lastSegmentHasTools()) this.openSegment();
		const segments = Object.freeze(
			this.activeSegments.map((s) => Object.freeze({ text: s.text, tools: Object.freeze([...s.tools]) })),
		);
		this.timeline[idx] = {
			...item,
			text: this.pendingFullText || segments.map((s) => s.text).join("") || item.text,
			segments,
			streaming: false,
		};
		this.resetActiveAssistant();
	}

	/** 当前段是否有工具行（决定空缓冲是否封段） */
	private lastSegmentHasTools(): boolean {
		return (this.activeSegments.at(-1)?.tools.length ?? 0) > 0;
	}

	/** 清空活跃 assistant 工作区 */
	private resetActiveAssistant(): void {
		this.activeAssistantSeq = undefined;
		this.activeSegments = [];
		this.activeSegmentText = "";
		this.continuingIntoLastSegment = false;
		this.textSinceLastTool = "";
		this.pendingFullText = undefined;
		this.activeIndex = -1;
		this.activeItemDirty = false;
	}

	/** run 收口：给最后一条 timeline 项补 runEndSequence/timestamp（工具归属范围终点） */
	private setRunEndOnLast(seq: number, ts: string): void {
		const last = this.timeline.at(-1);
		if (last === undefined) return;
		this.timeline[this.timeline.length - 1] = { ...last, runEndSequence: seq, timestamp: last.timestamp ?? ts };
	}

	private transition(state: ConversationProjectionState): void {
		this.state = state;
		// 错误态清空 liveState，防失败后残留 generating/thinking
		if (state === "error") {
			this.liveState = undefined;
			this.thinkingChars = undefined;
		}
		this.publish();
	}

	private publish(): void {
		// 发布前冲刷脏文本（保序不变量：任何立即发布路径——状态迁移 / 非 delta 事件 /
		// 窗口到期——看到的都是含最新 delta 的完整快照）
		if (this.activeItemDirty) {
			this.activeItemDirty = false;
			this.syncActiveItem();
		}
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

	/** 排程合并发布（32ms 尾沿；窗口内重复调用幂等并入） */
	private scheduleDirtyPublish(): void {
		if (this.publishTimer !== undefined) return;
		this.publishTimer = setTimeout(() => {
			this.publishTimer = undefined;
			this.publish();
		}, DIRTY_PUBLISH_MS);
	}

	/**
	 * eseq 断档补拉（ZMQ 丢包自愈）：重放 lastAppliedSequence 之后的 journal 历史。
	 * 纯 delta 断档（无 persist 缺口）补拉不到新事件——由下一个 persist 事件
	 * （assistant.message 携 fullText）在 turn 边界自愈。
	 */
	private scheduleCatchUp(): void {
		if (this.catchUpInFlight || this.state !== "running") return;
		this.catchUpInFlight = true;
		void (async () => {
			try {
				const events = await this.history({ fromSeq: this.lastAppliedSequence + 1, limit: 256 });
				if (!this.stopRequested) {
					for (const event of events) this.apply(event);
					this.publish();
				}
			} catch {
				// 补拉失败：下一次断档/事件再试
			} finally {
				this.catchUpInFlight = false;
			}
		})();
	}

	private buildSnapshot(): ConversationProjectionSnapshot {
		// 子数组「置脏才重建」：delta 高发路径（timeline 仅尾项变更）下其余数组保持冻结引用稳定，
		// 为 UI 层 memo 提供浅比较基础（见 docs/PRD/gui-performance.md §4.1）。
		if (this.cardsDirty) {
			this.cachedCards = Object.freeze(this.cardProjection.getCards());
			this.cardsDirty = false;
		}
		return Object.freeze({
			conversationId: this.conversationId,
			revision: this.revision,
			lastAppliedSequence: this.lastAppliedSequence,
			state: this.state,
			...(this.liveState !== undefined ? { liveState: this.liveState } : {}),
			...(this.thinkingChars !== undefined ? { thinkingChars: this.thinkingChars } : {}),
			timeline: Object.freeze([...this.timeline]),
			cards: this.cachedCards,
			...(this.mode !== undefined ? { mode: this.mode } : {}),
			...(this.modePending !== undefined ? { modePending: this.modePending } : {}),
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
