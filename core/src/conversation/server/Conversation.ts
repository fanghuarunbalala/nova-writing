/**
 * Conversation 实现：conversation 进程侧编排。
 * 组织 AgentLoop + OutputEvent 事件流 + mode 状态；实现 ConversationInteraction + WaitingInteractionRequest。
 */
import type { AgentLoop } from "../../runtime/loop/AgentLoop.js";
import type { SamplingConfig } from "../../runtime/provider/types.js";
import type { OutputEvent } from "../contract/events/index.js";
import type { ConversationInteraction } from "../contract/interaction/index.js";
import type { WaitingInteractionRequest } from "../contract/interaction/index.js";
import type {
	ConversationApprovalDecision,
	ConversationApprovalRequest,
	ConversationAskingRequest,
	ConversationExitComposeRequest,
	ConversationMode,
	ConversationSystemControl,
	ConversationUserCommand,
	ConversationUserMessage,
	Receipt,
} from "../contract/types/index.js";
import { DEFAULT_CONVERSATION_MODE } from "../contract/types/index.js";

/** Conversation 构造选项 */
export interface ConversationOptions {
	/** 会话 id */
	conversationId: string;
	/** agent 主循环（上层装配，可含 journal 持久化 listener） */
	loop: AgentLoop;
	/** 默认采样配置（sendUserMessage 用） */
	sampling: SamplingConfig;
}

/** 输出事件订阅回调 */
type OutputEventListener = (e: OutputEvent) => void;

/** conversation 进程侧实现（mode 状态 + 消息编排 + 事件分发 + 等待交互） */
export class Conversation implements ConversationInteraction, WaitingInteractionRequest {
	/** 会话 id */
	readonly conversationId: string;
	/** 当前生效的会话模式（当前 turn 使用） */
	private activeMode: ConversationMode = DEFAULT_CONVERSATION_MODE;
	/** 待生效模式（mode.set 设置，下一次 turn 才生效） */
	private pendingMode?: ConversationMode;
	/** agent 主循环 */
	private readonly loop: AgentLoop;
	/** 默认采样 */
	private readonly sampling: SamplingConfig;
	/** 输出事件订阅者（hub） */
	private readonly eventListeners = new Set<OutputEventListener>();
	/** 待决审批（requestId → resolve），阻塞等待决策 */
	private readonly pendingApprovals = new Map<string, (d: ConversationApprovalDecision) => void>();

	/**
	 * 构造 Conversation
	 * @param opts 会话 id + agent 循环 + 采样
	 */
	constructor(opts: ConversationOptions) {
		this.conversationId = opts.conversationId;
		this.loop = opts.loop;
		this.sampling = opts.sampling;
	}

	/** 当前生效的会话模式 */
	get conversationMode(): ConversationMode {
		return this.activeMode;
	}

	/** 发送用户消息（turn lane）：先应用待生效模式，再触发 agent 循环，事件经 hub 分发 */
	async sendUserMessage(msg: ConversationUserMessage): Promise<Receipt> {
		this.applyPendingMode();
		await this.loop.run(msg.text, { sampling: this.sampling }, (e) => this.emit(e));
		return this.receipt();
	}

	/** 发送用户命令（turn lane，agent 可见）：暂转为用户消息文本 */
	async sendUserCommand(cmd: ConversationUserCommand): Promise<Receipt> {
		this.applyPendingMode();
		const text = cmd.args ? `${cmd.name} ${JSON.stringify(cmd.args)}` : cmd.name;
		await this.loop.run(text, { sampling: this.sampling }, (e) => this.emit(e));
		return this.receipt();
	}

	/** 发送系统控制（control lane，可抢占）：mode.set（待下次 turn 生效）/ stop / reload.config */
	async sendSystemControl(ctrl: ConversationSystemControl): Promise<Receipt> {
		switch (ctrl.type) {
			case "mode.set":
				// 不立即生效：仅记录 pendingMode，下一次 turn 开始时才切换
				this.pendingMode = ctrl.mode;
				break;
			case "stop":
				this.loop.cancel();
				break;
			case "reload.config":
				break;
		}
		return this.receipt();
	}

	/** 应用待生效模式：pendingMode → activeMode（下一次 turn 开始时调用） */
	private applyPendingMode(): void {
		if (this.pendingMode !== undefined) {
			this.activeMode = this.pendingMode;
			this.pendingMode = undefined;
		}
	}

	/** 请求审批（阻塞直到决策经 resolveApproval 回传） */
	async sendApprovalRequest(req: ConversationApprovalRequest): Promise<ConversationApprovalDecision> {
		return new Promise<ConversationApprovalDecision>((resolve) => {
			this.pendingApprovals.set(req.requestId, resolve);
			// TODO: 发射审批请求事件给 UI / 经 manager 路由到 parent
		});
	}

	/** 请求提问（阻塞直到回答） */
	async sendAskingQuestionRequest(_req: ConversationAskingRequest): Promise<string> {
		throw new Error("sendAskingQuestionRequest 尚未实现");
	}

	/** 请求退出 compose（阻塞直到退出） */
	async sendExitComposeRequest(_req: ConversationExitComposeRequest): Promise<void> {
		throw new Error("sendExitComposeRequest 尚未实现");
	}

	/** 订阅输出事件流（push-based hub；break/return 即取消订阅） */
	events(): AsyncIterable<OutputEvent> {
		const queue: OutputEvent[] = [];
		const waiters: Array<() => void> = [];
		const onEvent: OutputEventListener = (e) => {
			queue.push(e);
			const wake = waiters.shift();
			if (wake) wake();
		};
		const unsubscribe = this.subscribe(onEvent);
		return {
			[Symbol.asyncIterator]() {
				return {
					next: () =>
						new Promise<IteratorResult<OutputEvent>>((resolve) => {
							if (queue.length > 0) {
								resolve({ value: queue.shift()!, done: false });
							} else {
								waiters.push(() => resolve({ value: queue.shift()!, done: false }));
							}
						}),
					return: () => {
						unsubscribe();
						return Promise.resolve({ value: undefined as unknown as OutputEvent, done: true });
					},
				};
			},
		};
	}

	/** 释放（清空订阅者） */
	dispose(): void {
		this.eventListeners.clear();
	}

	/** 解析待决审批（决策回传，供 manager / UI 应答调用） */
	resolveApproval(requestId: string, decision: ConversationApprovalDecision): void {
		const resolve = this.pendingApprovals.get(requestId);
		if (resolve) {
			this.pendingApprovals.delete(requestId);
			resolve(decision);
		}
	}

	/** 分发输出事件给所有订阅者 */
	private emit(e: OutputEvent): void {
		for (const l of this.eventListeners) l(e);
	}

	/** 订阅事件（内部：外部经 events() 订阅时注册 listener），返回取消订阅函数 */
	private subscribe(l: OutputEventListener): () => void {
		this.eventListeners.add(l);
		return () => {
			this.eventListeners.delete(l);
		};
	}

	/** 构造持久化回执 */
	private receipt(): Receipt {
		return { seq: 0, recordedAt: new Date().toISOString() };
	}
}
