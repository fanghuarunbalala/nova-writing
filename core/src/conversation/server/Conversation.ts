/**
 * Conversation 实现：conversation 进程侧编排。
 * 组织 AgentLoop + OutputEvent 事件流 + mode 状态；实现 ConversationInteraction + WaitingInteractionRequest。
 */
import type { AgentLoop } from "../../runtime/loop/AgentLoop.js";
import type { SamplingConfig } from "../../runtime/provider/types.js";
import type { OutputEvent } from "../contract/events/index.js";
import type { ConversationJournalService } from "../contract/journal/index.js";
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
import type { SubagentRuntime } from "./SubagentRuntime.js";

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
	/** subagent 任务编排（存在时：事件转发进 hub + stop/dispose 级联 stopAll） */
	subagentRuntime?: SubagentRuntime;
	/** 初始模式（storedir 恢复；缺省 DEFAULT_CONVERSATION_MODE） */
	initialMode?: ConversationMode;
	/** 模式变更持久化回调（applyPendingMode 生效时调用；写失败由回调自行忽略） */
	onModeChanged?: (mode: ConversationMode) => void;
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
	/** 最近已持久化的模式（去重：同值不重复写盘） */
	private lastPersistedMode: ConversationMode | undefined;
	/** agent 主循环 */
	private readonly loop: AgentLoop;
	/** 默认采样 */
	private readonly sampling: SamplingConfig;
	/** subagent 任务编排（可选） */
	private readonly subagentRuntime?: SubagentRuntime;
	/** 输出事件订阅者（hub） */
	private readonly eventListeners = new Set<OutputEventListener>();
	/** journal 写侧（缺省 undefined = 不落盘） */
	private readonly journal?: ConversationJournalService;
	/** manager wait 通道（wait 请求经 CMS 队列路由） */
	private readonly managerWait?: ManagerWaitChannel;
	/** wait 超时毫秒 */
	private readonly waitTimeoutMs: number;
	/** 超时是否启用（显式配置 waitTimeoutMs 或 onWaitTimeout 才启用；生产子进程驻留等待不超时） */
	private readonly waitTimeoutEnabled: boolean;
	/** wait 超时回调（测试/内存模式注入；生产子进程不注入） */
	private readonly onWaitTimeout?: (requestId: string) => void;
	/** 模式变更持久化回调（可选：子进程注入 meta.json 落盘） */
	private readonly onModeChanged?: (mode: ConversationMode) => void;
	/** 待决审批（requestId → {resolve, timer}），无阻塞驻留等待决策 */
	private readonly pendingApprovals = new Map<
		string,
		{ resolve: (d: ConversationApprovalDecision) => void; timer: NodeJS.Timeout | undefined }
	>();
	/** 待决提问（requestId → resolve） */
	private readonly pendingQuestions = new Map<string, (answer: string) => void>();
	/** 待决退出 compose（requestId → resolve） */
	private readonly pendingExitCompose = new Map<string, () => void>();

	/**
	 * 构造 Conversation
	 * @param opts 会话 id + agent 循环 + 采样 + 可选 journal 写侧 + manager wait 通道
	 */
	constructor(opts: ConversationOptions) {
		this.conversationId = opts.conversationId;
		this.loop = opts.loop;
		this.sampling = opts.sampling;
		this.journal = opts.journal;
		this.managerWait = opts.managerWait;
		this.waitTimeoutMs = opts.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
		this.waitTimeoutEnabled = opts.waitTimeoutMs !== undefined || opts.onWaitTimeout !== undefined;
		this.onWaitTimeout = opts.onWaitTimeout;
		this.subagentRuntime = opts.subagentRuntime;
		this.activeMode = opts.initialMode ?? DEFAULT_CONVERSATION_MODE;
		this.lastPersistedMode = opts.initialMode;
		this.onModeChanged = opts.onModeChanged;
		// 订阅 loop 的输出事件（run/followup 均转发到本会话 hub）
		this.loop.onOutputEvent((e) => this.emit(e));
		// subagent loop 事件同样进 hub（live-only，不落 journal）
		this.subagentRuntime?.onEvent((e) => this.emit(e));
	}

	/** 当前生效的会话模式 */
	get conversationMode(): ConversationMode {
		return this.activeMode;
	}

	/** 查询当前生效模式（ConversationHandle 契约；跨 RPC 可调） */
	async getConversationMode(): Promise<ConversationMode> {
		return this.activeMode;
	}

	/**
	 * 发送用户消息（turn lane）：先应用待生效模式，再入队 followup（不阻塞等待完成）。
	 * turn 在 followup 时即时创建；有 journal 时同步落盘 user 消息快照后返回持久化回执。
	 */
	async sendUserMessage(msg: ConversationUserMessage): Promise<Receipt> {
		this.applyPendingMode();
		const turn = this.loop.followup(msg.text, { sampling: this.sampling });
		return this.journal !== undefined ? await this.journal.appendTurn(turn) : this.receipt(turn.seq);
	}

	/** 发送用户命令（turn lane，agent 可见）：转文本入队 */
	async sendUserCommand(cmd: ConversationUserCommand): Promise<Receipt> {
		this.applyPendingMode();
		const text = cmd.args ? `${cmd.name} ${JSON.stringify(cmd.args)}` : cmd.name;
		const turn = this.loop.followup(text, { sampling: this.sampling });
		return this.journal !== undefined ? await this.journal.appendTurn(turn) : this.receipt(turn.seq);
	}

	/** 发送系统控制（control lane，可抢占）：mode.set（待下次 turn 生效）/ stop / reload.config */
	async sendSystemControl(ctrl: ConversationSystemControl): Promise<Receipt> {
		switch (ctrl.type) {
			case "mode.set":
				// 不立即生效：仅记录 pendingMode，下一次 turn 开始时才切换
				this.pendingMode = ctrl.mode;
				break;
			case "stop":
				this.loop.stop();
				// 级联停止全部 subagent 任务
				this.subagentRuntime?.stopAll();
				break;
			case "reload.config":
				break;
		}
		// 控制不入 journal：回执用最近落盘的 turn seq
		return this.receipt(this.journal?.lastSeq ?? 0);
	}

	/** 应用待生效模式：pendingMode → activeMode（下一次 turn 开始时调用） */
	private applyPendingMode(): void {
		if (this.pendingMode !== undefined) {
			this.activeMode = this.pendingMode;
			this.pendingMode = undefined;
			if (this.activeMode !== this.lastPersistedMode) {
				this.lastPersistedMode = this.activeMode;
				try {
					this.onModeChanged?.(this.activeMode);
				} catch {
					// 持久化失败不影响内存态（重启回退默认模式）
				}
			}
		}
	}

	/**
	 * 请求审批（无阻塞）：经 manager wait 通道提交 CMS 队列（request/resolve 分离），
	 * 返回决策 promise 供 gateTool 驻留等待；决策经 resolveApproval 回传解除；
	 * 超时（waitTimeoutMs）按拒绝解除并触发 onWaitTimeout（子进程退出行为）。
	 * 不再经 output hub 发 approval 事件——wait 状态唯一权威是 CMS 队列。
	 */
	async sendApprovalRequest(req: ConversationApprovalRequest): Promise<ConversationApprovalDecision> {
		// bypass 模式：用户已显式免审，直接放行（不进队列、不驻留等待）
		if (this.activeMode === "bypass") return { kind: "approve" };
		return new Promise<ConversationApprovalDecision>((resolve) => {
			// 超时未启用（生产子进程）：不设定时器，驻留等待直到决策回传——
			// 提前超时会丢内存态（subagent/todo）且 UI 决策无法送达
			const timer = this.waitTimeoutEnabled
				? setTimeout(() => {
						this.pendingApprovals.delete(req.requestId);
						this.onWaitTimeout?.(req.requestId);
						resolve({ kind: "reject" });
					}, this.waitTimeoutMs)
				: undefined;
			this.pendingApprovals.set(req.requestId, { resolve, timer });
			if (this.managerWait !== undefined) {
				void this.managerWait
					.submitApproval(this.conversationId, req)
					.catch(() => {
						// 提交失败：立即按拒绝解除，避免悬挂
						const pending = this.pendingApprovals.get(req.requestId);
						if (pending === undefined) return;
						if (pending.timer !== undefined) clearTimeout(pending.timer);
						this.pendingApprovals.delete(req.requestId);
						resolve({ kind: "reject" });
					});
			}
		});
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
		this.eventListeners.add(listener);
	}

	/** 释放（清空订阅者 + 停止 subagent 任务） */
	dispose(): void {
		this.subagentRuntime?.stopAll();
		this.eventListeners.clear();
	}

	/** 解析待决审批（决策回传：CMS 经 rpc 调用；解除 gateTool 的驻留等待） */
	resolveApproval(requestId: string, decision: ConversationApprovalDecision): void {
		const pending = this.pendingApprovals.get(requestId);
		if (pending) {
			if (pending.timer !== undefined) clearTimeout(pending.timer);
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
