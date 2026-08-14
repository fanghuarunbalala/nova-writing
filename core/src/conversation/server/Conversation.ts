/**
 * Conversation 实现：conversation 进程侧编排。
 * 组织 AgentLoop + OutputEvent 事件流 + mode 状态；实现 ConversationInteraction + WaitingInteractionRequest。
 */
import type { AgentLoop } from "../../runtime/loop/AgentLoop.js";
import type { SamplingConfig } from "../../runtime/provider/types.js";
import type { OutputEvent } from "../contract/events/index.js";
import { debugLog } from "../../log/debug.js";
import type { ConversationJournalService, ConversationStateJournalService } from "../contract/journal/index.js";
import type { ComposeModeStateProvider } from "../compose/ComposeModeState.js";
import type { ComposeModeService } from "../compose/ComposeModeService.js";
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

/** manager wait 通道：conversation → CMS 的 wait 提交面（子进程经 manager WS；内存模式直连 managerServer） */
export interface ManagerWaitChannel {
	/**
	 * 提交审批请求（非阻塞 rpc；决策经 resolveApproval 回传——驻留直推或重启查询）
	 * @param conversationId 发起会话 id
	 * @param req 审批请求
	 */
	submitApproval(conversationId: string, req: ConversationApprovalRequest): Promise<void>;
	/**
	 * 提交提问请求（非阻塞；路由同审批）
	 * @param conversationId 发起会话 id
	 * @param req 提问请求
	 */
	submitAsking(conversationId: string, req: ConversationAskingRequest): Promise<void>;
	/**
	 * 提交退出 compose 请求（非阻塞；路由同审批）
	 * @param conversationId 发起会话 id
	 * @param req 退出请求
	 */
	submitExitCompose(conversationId: string, req: ConversationExitComposeRequest): Promise<void>;
}

/** Conversation 构造选项 */
export interface ConversationOptions {
	/** 会话 id */
	conversationId: string;
	/** agent 主循环（上层装配，可含 journal 持久化 listener） */
	loop: AgentLoop;
	/** 默认采样配置（sendUserMessage 用） */
	sampling: SamplingConfig;
	/** journal 写侧（注入时输入 rpc 落盘即回持久化回执；缺省回 turn seq） */
	journal?: ConversationJournalService;
	/** manager wait 通道（wait 请求经 CMS 队列路由；缺省仅进程内挂起等待） */
	managerWait?: ManagerWaitChannel;
	/** wait 超时毫秒（缺省 120000） */
	waitTimeoutMs?: number;
	/** wait 超时回调（子进程注入 process.exit 等退出行为；内存模式仅解除等待） */
	onWaitTimeout?: (requestId: string) => void;
	/** compose 状态提供者（getConversationMode 权威；缺省走 activeMode 字段回退） */
	composeState?: ComposeModeStateProvider;
	/** compose 工具服务（mode.set 语义 + ExitComposeMode 审批状态驱动；缺省纯字段语义） */
	composeService?: ComposeModeService;
	/** 状态事件 sidecar 写侧（persist 状态事件落盘，重启 hydrate 重放用） */
	stateJournal?: ConversationStateJournalService;
}

/** 输出事件订阅回调 */
type OutputEventListener = (e: OutputEvent) => void;

/** wait 缺省超时：120s（驻留等待决策；超时按拒绝处理 + onWaitTimeout 退出行为） */
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;

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
	/** journal 写侧（缺省 undefined = 不落盘） */
	private readonly journal?: ConversationJournalService;
	/** manager wait 通道（wait 请求经 CMS 队列路由） */
	private readonly managerWait?: ManagerWaitChannel;
	/** wait 超时毫秒 */
	private readonly waitTimeoutMs: number;
	/** wait 超时回调（子进程注入退出行为） */
	private readonly onWaitTimeout?: (requestId: string) => void;
	/** compose 状态提供者（getConversationMode 权威；缺省字段回退） */
	private readonly composeState?: ComposeModeStateProvider;
	/** compose 工具服务（mode.set 语义 + Exit 审批状态驱动） */
	private readonly composeService?: ComposeModeService;
	/** 状态事件 sidecar 写侧（persist 状态事件落盘） */
	private readonly stateJournal?: ConversationStateJournalService;
	/** 待决审批（requestId → {resolve, timer}），无阻塞驻留等待决策 */
	private readonly pendingApprovals = new Map<
		string,
		{ resolve: (d: ConversationApprovalDecision) => void; timer: NodeJS.Timeout }
	>();
	/** 待决提问（requestId → resolve） */
	private readonly pendingQuestions = new Map<string, (answer: string) => void>();
	/** 待决退出 compose（requestId → resolve） */
	private readonly pendingExitCompose = new Map<string, () => void>();

	/**
	 * 构造 Conversation
	 * @param opts 会话 id + agent 循环 + 采样 + 可选 journal 写侧 + manager wait 通道
	 * + compose 状态/服务（mode 双态与 Exit 审批驱动）
	 */
	constructor(opts: ConversationOptions) {
		this.conversationId = opts.conversationId;
		this.loop = opts.loop;
		this.sampling = opts.sampling;
		this.journal = opts.journal;
		this.managerWait = opts.managerWait;
		this.waitTimeoutMs = opts.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
		this.onWaitTimeout = opts.onWaitTimeout;
		this.composeState = opts.composeState;
		this.composeService = opts.composeService;
		this.stateJournal = opts.stateJournal;
		// 订阅 loop 的输出事件（run/followup 均转发到本会话 hub）
		this.loop.onOutputEvent((e) => this.emit(e));
	}

	/** 当前生效的会话模式（注入 composeState 时以快照为准） */
	get conversationMode(): ConversationMode {
		return this.composeState?.snapshot(this.conversationId).mode ?? this.activeMode;
	}

	/** 查询当前生效模式（ConversationHandle 契约；跨 RPC 可调） */
	async getConversationMode(): Promise<ConversationMode> {
		return this.conversationMode;
	}

	/**
	 * 发送用户消息（turn lane）：入队 followup（不阻塞等待完成）。
	 * turn 在 followup 时即时创建；有 journal 时同步落盘 user 消息快照后返回持久化回执。
	 */
	async sendUserMessage(msg: ConversationUserMessage): Promise<Receipt> {
		const turn = this.loop.followup(msg.text, { sampling: this.sampling });
		return this.journal !== undefined ? await this.journal.appendTurn(turn) : this.receipt(turn.seq);
	}

	/** 发送用户命令（turn lane，agent 可见）：转文本入队 */
	async sendUserCommand(cmd: ConversationUserCommand): Promise<Receipt> {
		const text = cmd.args ? `${cmd.name} ${JSON.stringify(cmd.args)}` : cmd.name;
		const turn = this.loop.followup(text, { sampling: this.sampling });
		return this.journal !== undefined ? await this.journal.appendTurn(turn) : this.receipt(turn.seq);
	}

	/**
	 * 发送系统控制（control lane，可抢占）：mode.set（记 pendingMode + 发 mode.pending 瞬态事件；
	 * active 实际切换在每次 provider call 发起时经 promotePendingMode 晋升）/ stop / reload.config
	 */
	async sendSystemControl(ctrl: ConversationSystemControl): Promise<Receipt> {
		switch (ctrl.type) {
			case "mode.set":
				// 双态模型：只记 pendingMode，下一次 provider call 发起时才晋升 active（F1）
				this.pendingMode = ctrl.mode;
				this.emitState({
					type: "mode.pending",
					persist: false,
					mode: ctrl.mode,
					conversationId: this.conversationId,
					ts: new Date().toISOString(),
				});
				break;
			case "stop":
				this.loop.stop();
				break;
			case "reload.config":
				break;
		}
		// 控制不入 journal：回执用最近落盘的 turn seq
		return this.receipt(this.journal?.lastSeq ?? 0);
	}

	/**
	 * 晋升待生效模式：pendingMode → active（每次 provider call 发起时由
	 * beforeProviderCall 注入调用）。先应用 compose 服务中审核期延迟的 mode 目标，
	 * 再落 pendingMode；无服务时走 activeMode 字段回退（测试/未装配路径）。
	 */
	async promotePendingMode(): Promise<void> {
		await this.composeService?.applyPendingModeTarget(this.conversationId);
		const target = this.pendingMode;
		if (target === undefined) return;
		this.pendingMode = undefined;
		if (this.composeService !== undefined) {
			await this.composeService.setMode(this.conversationId, target);
			return;
		}
		this.activeMode = target;
	}

	/** 是否存在挂起审批（compose 服务 setMode 延迟判定的探测面） */
	hasPendingApproval(): boolean {
		return this.pendingApprovals.size > 0;
	}

	/**
	 * 请求审批（无阻塞）：经 manager wait 通道提交 CMS 队列（request/resolve 分离），
	 * 返回决策 promise 供 gateTool 驻留等待；决策经 resolveApproval 回传解除；
	 * 超时（waitTimeoutMs）按拒绝解除并触发 onWaitTimeout（子进程退出行为）。
	 * 不再经 output hub 发 approval 事件——wait 状态唯一权威是 CMS 队列。
	 * ExitComposeMode 包装：提交前 service.submit（designing→pending）；决议 approve →
	 * compose.approved 瞬态事件；reject/edit → designing + 晋升延迟 mode 目标。
	 */
	async sendApprovalRequest(req: ConversationApprovalRequest): Promise<ConversationApprovalDecision> {
		// ExitComposeMode：提交前 submit（designing→pending）。submit 内部全同步
		//（状态迁移 + 事件），先于队列注册完成，保证写序且不引入微任务竞态
		if (req.toolName === "ExitComposeMode" && this.composeService !== undefined) {
			void this.composeService.submit(this.conversationId, req.requestId);
		}
		return new Promise<ConversationApprovalDecision>((resolve) => {
			// 决议包装：先驱动 compose 状态迁移（写序），再解除 gateTool 驻留
			const settle = (decision: ConversationApprovalDecision): void => {
				void this.driveExitComposeDecision(req, decision).then(
					() => resolve(decision),
					() => resolve(decision),
				);
			};
			const timer = setTimeout(() => {
				this.pendingApprovals.delete(req.requestId);
				this.onWaitTimeout?.(req.requestId);
				settle({ kind: "reject" });
			}, this.waitTimeoutMs);
			this.pendingApprovals.set(req.requestId, { resolve: settle, timer });
			if (this.managerWait !== undefined) {
				void this.managerWait
					.submitApproval(this.conversationId, req)
					.catch(() => {
						// 提交失败：立即按拒绝解除，避免悬挂
						const pending = this.pendingApprovals.get(req.requestId);
						if (pending === undefined) return;
						clearTimeout(pending.timer);
						this.pendingApprovals.delete(req.requestId);
						settle({ kind: "reject" });
					});
			}
		});
	}

	/** ExitComposeMode 决议驱动：approve → compose.approved；reject/edit → designing + 晋升延迟目标 */
	private async driveExitComposeDecision(
		req: ConversationApprovalRequest,
		decision: ConversationApprovalDecision,
	): Promise<void> {
		if (req.toolName !== "ExitComposeMode" || this.composeService === undefined) return;
		if (decision.kind === "approve") {
			await this.composeService.approveOnDecision(this.conversationId);
			return;
		}
		await this.composeService.rejectOnDecision(this.conversationId);
		await this.composeService.applyPendingModeTarget(this.conversationId);
	}

	/** 请求提问（无阻塞；路由同审批，UI 展示延后） */
	async sendAskingQuestionRequest(req: ConversationAskingRequest): Promise<string> {
		return new Promise<string>((resolve) => {
			this.pendingQuestions.set(req.requestId, resolve);
			if (this.managerWait !== undefined) {
				void this.managerWait.submitAsking(this.conversationId, req).catch(() => {
					// 提交失败：解除避免悬挂
					this.pendingQuestions.delete(req.requestId);
					resolve("");
				});
			}
		});
	}

	/** 请求退出 compose（无阻塞；路由同审批） */
	async sendExitComposeRequest(req: ConversationExitComposeRequest): Promise<void> {
		return new Promise<void>((resolve) => {
			this.pendingExitCompose.set(req.requestId, resolve);
			if (this.managerWait !== undefined) {
				void this.managerWait.submitExitCompose(this.conversationId, req).catch(() => {
					this.pendingExitCompose.delete(req.requestId);
					resolve();
				});
			}
		});
	}

	/** 订阅输出事件流（hub 实时推送；dispose 清空全部订阅者） */
	async subscribeEvents(listener: OutputEventListener): Promise<void> {
		debugLog("[child] subscribeEvents listener type:", typeof listener, "===", String(listener).slice(0, 60));
		this.eventListeners.add(listener);
	}

	/** 释放（清空订阅者） */
	dispose(): void {
		this.eventListeners.clear();
	}

	/** 解析待决审批（决策回传：CMS 经 rpc 调用；解除 gateTool 的驻留等待） */
	resolveApproval(requestId: string, decision: ConversationApprovalDecision): void {
		const pending = this.pendingApprovals.get(requestId);
		if (pending) {
			clearTimeout(pending.timer);
			this.pendingApprovals.delete(requestId);
			pending.resolve(decision);
		}
	}

	/** 解析待决提问（回答回传） */
	resolveQuestion(requestId: string, answer: string): void {
		const resolve = this.pendingQuestions.get(requestId);
		if (resolve) {
			this.pendingQuestions.delete(requestId);
			resolve(answer);
		}
	}

	/** 解析待决退出 compose（完成回传） */
	resolveExitCompose(requestId: string): void {
		const resolve = this.pendingExitCompose.get(requestId);
		if (resolve) {
			this.pendingExitCompose.delete(requestId);
			resolve();
		}
	}

	/** 分发输出事件给所有订阅者 */
	private emit(e: OutputEvent): void {
		for (const l of this.eventListeners) l(e);
	}

	/**
	 * 状态事件出口（compose 服务 eventSink 装配目标）：写序 = ②persist 先落
	 * state.jsonl（appendFileSync 同步落盘）→ ③hub 广播；瞬态事件仅广播。
	 * @param e 状态事件（compose.* / mode.*）
	 */
	emitState(e: OutputEvent): void {
		if (e.persist) void this.stateJournal?.append(e);
		this.emit(e);
	}

	/** 订阅事件（内部：外部经 events() 订阅时注册 listener），返回取消订阅函数 */
	private subscribe(l: OutputEventListener): () => void {
		this.eventListeners.add(l);
		return () => {
			this.eventListeners.delete(l);
		};
	}

	/** 构造持久化回执（seq = turn seq / journal lastSeq） */
	private receipt(seq: number): Receipt {
		return { seq, recordedAt: new Date().toISOString() };
	}
}
