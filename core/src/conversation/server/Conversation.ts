/**
 * Conversation 实现：conversation 进程侧编排。
 * 组织 AgentLoop + LoopEvent 事件流 + mode 状态；实现 ConversationInteraction + WaitingInteractionRequest。
 */
import type { AgentLoop } from "../../runtime/loop/AgentLoop.js";
import type { LoopEvent } from "../../runtime/loop/types.js";
import type { SamplingConfig } from "../../runtime/provider/types.js";
import type { ProjectedEvent, StateEvent } from "../contract/events/index.js";
import { ProjectionLayer } from "../projection/ProjectionLayer.js";
import type { Logger } from "../../log/Logger.js";
import { noopLogger } from "../../log/noop.js";
import { CONVERSATION_OUTPUT } from "../../event/topics.js";
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
	/** journal 写侧（注入时输入 rpc 落盘即回持久化回执；缺省回 run seq） */
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
	/** 投影层（缺省内建；preview resolver 经 loop.toolDispatcher 取 ToolDef.preview） */
	projection?: ProjectionLayer;
	/** subagent 任务编排（存在时：事件转发进 hub + stop/dispose 级联 stopAll） */
	subagentRuntime?: SubagentRuntime;
	/** 初始模式（storedir 恢复；缺省 DEFAULT_CONVERSATION_MODE） */
	initialMode?: ConversationMode;
	/** 模式变更持久化回调（模式生效时调用；写失败由回调自行忽略） */
	onModeChanged?: (mode: ConversationMode) => void;
	/** 结构化日志（缺省 noop；审批入队/决议、mode 晋升、状态落盘失败等关键链路埋点） */
	logger?: Logger;
	/**
	 * 事件发布器（ZeroMQ PUB 形态；gui-performance-2 功能点八——事件火线
	 * fire-and-forget 广播，与 kkrpc 控制通道分离）。缺省仅内存 hub。
	 */
	eventPublisher?: ConversationEventPublisher;
}

/** 事件发布器（结构化接口：child 注入 EventPublisher；测试/内存模式缺省） */
export interface ConversationEventPublisher {
	publish(topic: string, payload: unknown): void;
}

/** 输出事件订阅回调（hub 广播投影事件 + compose/mode 状态事件） */
type ProjectedEventListener = (e: ProjectedEvent) => void;

/** wait 缺省超时：120s（驻留等待决策；超时按拒绝处理 + onWaitTimeout 退出行为） */
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;

/** conversation 进程侧实现（mode 状态 + 消息编排 + 事件分发 + 等待交互） */
export class Conversation implements ConversationInteraction, WaitingInteractionRequest {
	/** 会话 id */
	readonly conversationId: string;
	/** 当前生效的会话模式（当前 run 使用；composeState 缺省时的回退载体） */
	private activeMode: ConversationMode = DEFAULT_CONVERSATION_MODE;
	/** 待生效模式（mode.set 设置，下一次 provider call / run 才生效） */
	private pendingMode?: ConversationMode;
	/** 最近已持久化的模式（去重：同值不重复写盘） */
	private lastPersistedMode: ConversationMode | undefined;
	/** agent 主循环 */
	private readonly loop: AgentLoop;
	/** 默认采样 */
	private readonly sampling: SamplingConfig;
	/** 投影层（main loop 事件用；完整 LoopEvent → ProjectedEvent，live 流唯一出口） */
	private readonly projection: ProjectionLayer;
	/** subagent 投影层（agentId → 实例；一任务一实例，pending 配对互不可见，run-end 后清理） */
	private readonly subagentProjections = new Map<string, ProjectionLayer>();
	/** subagent 任务编排（可选；事件经独立投影层进 hub，客户端按 agentId 过滤） */
	private readonly subagentRuntime?: SubagentRuntime;
	/** 输出事件订阅者（hub，只收投影事件） */
	private readonly eventListeners = new Set<ProjectedEventListener>();
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
	/** compose 状态提供者（getConversationMode 权威；缺省字段回退） */
	private readonly composeState?: ComposeModeStateProvider;
	/** compose 工具服务（mode.set 语义 + Exit 审批状态驱动） */
	private readonly composeService?: ComposeModeService;
	/** 状态事件 sidecar 写侧（persist 状态事件落盘） */
	private readonly stateJournal?: ConversationStateJournalService;
	/** 模式变更持久化回调（可选：子进程注入 meta.json 落盘） */
	private readonly onModeChanged?: (mode: ConversationMode) => void;
	/** 结构化日志（审批/mode/状态事件关键链路埋点；缺省 noop） */
	private readonly logger: Logger;
	/** 事件发布器（可选：child 侧 ZeroMQ PUB 广播；缺省仅内存 hub） */
	private readonly eventPublisher?: ConversationEventPublisher;
	/** 事件流序号（逐会话单调递增；消费方 eseq 断档检测重放用） */
	private eventSeq = 0;
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
	 * + compose 状态/服务（mode 双态与 Exit 审批驱动）+ subagent 编排
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
		this.composeState = opts.composeState;
		this.composeService = opts.composeService;
		this.stateJournal = opts.stateJournal;
		this.subagentRuntime = opts.subagentRuntime;
		this.activeMode = opts.initialMode ?? DEFAULT_CONVERSATION_MODE;
		this.lastPersistedMode = opts.initialMode;
		this.onModeChanged = opts.onModeChanged;
		this.logger = (opts.logger ?? noopLogger).child({ component: "conversation" });
		this.eventPublisher = opts.eventPublisher;
		// 投影层：缺省经 loop.toolDispatcher 取 ToolDef.preview（live 与 replay 同实现）
		this.projection = opts.projection ?? this.createProjection();
		// 订阅 loop 的输出事件：经投影层映射后转发到本会话 hub（hub 只广播 ProjectedEvent）
		this.loop.onOutputEvent((e) => {
			const projected = this.projection.project(e);
			if (projected !== undefined) this.emit(projected);
		});
		// subagent loop 事件同样进 hub（live-only，不落 journal；经按 agentId 独立的投影层，
		// subagent 的 run-end 只清自己的 pending 配对，不触碰 main 的——
		// PRD `conversation-run-turn-术语统一` §4.6）
		this.subagentRuntime?.onEvent((e) => {
			const projected = this.projectSubagentEvent(e);
			if (projected !== undefined) this.emit(projected);
		});
	}

	/** 当前生效的会话模式（注入 composeState 时以快照为准） */
	get conversationMode(): ConversationMode {
		return this.composeState?.snapshot(this.conversationId).mode ?? this.activeMode;
	}

	/** 新建投影层（preview 经 loop.toolDispatcher 取 ToolDef.preview，live 与 replay 同实现） */
	private createProjection(): ProjectionLayer {
		return new ProjectionLayer({
			resolvePreview: {
				resolvePreview: (name) => this.loop.toolDispatcher.resolve(name)?.preview,
			},
		});
	}

	/**
	 * subagent 事件过独立投影层（agentId 一任务一实例）：pending 配对状态与 main、
	 * 与其他任务互不可见。run-end 后清理实例（agentId 含唯一 taskId 不复用；
	 * 异常未收口任务的残留实例只含小 Map，无增长上限风险）。
	 */
	private projectSubagentEvent(e: LoopEvent): ProjectedEvent | undefined {
		const key = e.agentId ?? "";
		let projection = this.subagentProjections.get(key);
		if (projection === undefined) {
			projection = this.createProjection();
			this.subagentProjections.set(key, projection);
		}
		const projected = projection.project(e);
		if (e.type === "run-end") this.subagentProjections.delete(key);
		return projected;
	}

	/** 查询当前生效模式（ConversationHandle 契约；跨 RPC 可调） */
	async getConversationMode(): Promise<ConversationMode> {
		return this.conversationMode;
	}

	/**
	 * 发送用户消息（run lane）：先晋升待生效模式，再入队 followup（不阻塞等待完成）。
	 * 晋升失败不阻断发消息（mode.promote_failed 已记日志、pendingMode 保留）——
	 * run 内 beforeProviderCall 仍会重试晋升；消息丢弃比 mode 延后生效伤害更大。
	 * run 在 followup 时即时创建；有 journal 时同步落盘 user 消息快照后返回持久化回执。
	 */
	async sendUserMessage(msg: ConversationUserMessage): Promise<Receipt> {
		await this.promotePendingMode().catch(() => undefined);
		const run = this.loop.followup(msg.text, { sampling: this.sampling });
		return this.journal !== undefined ? await this.journal.appendRun(run) : this.receipt(run.seq);
	}

	/** 发送用户命令（run lane，agent 可见）：转文本入队 */
	async sendUserCommand(cmd: ConversationUserCommand): Promise<Receipt> {
		const text = cmd.args ? `${cmd.name} ${JSON.stringify(cmd.args)}` : cmd.name;
		const run = this.loop.followup(text);
		return this.journal !== undefined ? await this.journal.appendRun(run) : this.receipt(run.seq);
	}

	/**
	 * 发送系统控制（control lane，可抢占）：mode.set（记 pendingMode + 发 mode.pending 瞬态事件；
	 * active 实际切换在每次 provider call 发起时经 promotePendingMode 晋升，run 开始时兜底再晋升一次）
	 * / stop / reload.config
	 */
	async sendSystemControl(ctrl: ConversationSystemControl): Promise<Receipt> {
		switch (ctrl.type) {
			case "mode.set":
				// 双态模型：只记 pendingMode，下一次 provider call 发起时才晋升 active（F1）
				this.pendingMode = ctrl.mode;
				this.logger.info("mode.set_recorded", { mode: ctrl.mode });
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
				// 级联停止全部 subagent 任务
				this.subagentRuntime?.stopAll();
				break;
			case "reload.config":
				break;
		}
		// 控制不入 journal：回执用最近落盘的 run seq
		return this.receipt(this.journal?.lastSeq ?? 0);
	}

	/**
	 * 晋升待生效模式：pendingMode → active（每次 provider call 发起时由
	 * beforeProviderCall 注入调用；sendUserMessage 开 run 时兜底调用）。先应用 compose
	 * 服务中审核期延迟的 mode 目标，再落 pendingMode；无服务时走 activeMode 字段回退
	 * （测试/gui 回显模式），同样广播 mode.changed（清 UI「待生效」chip）。
	 * 失败语义：setMode 抛错时 pendingMode 保留（下次 provider call 重试）并记
	 * mode.promote_failed 后向上抛——调用方（sendUserMessage 吞掉续发 / loop 侧失败 run）。
	 * 实际生效的模式经 persistModeIfChanged 去重写 meta.json。
	 */
	async promotePendingMode(): Promise<void> {
		await this.composeService?.applyPendingModeTarget(this.conversationId);
		const target = this.pendingMode;
		if (target === undefined) return;
		if (this.composeService !== undefined) {
			try {
				await this.composeService.setMode(this.conversationId, target);
			} catch (error) {
				this.logger.error("mode.promote_failed", { target, error: String(error) });
				throw error;
			}
			this.pendingMode = undefined;
			return;
		}
		this.activeMode = target;
		this.pendingMode = undefined;
		this.emitState({
			type: "mode.changed",
			persist: true,
			mode: target,
			conversationId: this.conversationId,
			ts: new Date().toISOString(),
		});
	}

	/** 模式去重持久化（onModeChanged 回调；失败忽略，重启回退已落盘值） */
	private persistModeIfChanged(mode: ConversationMode): void {
		if (mode === this.lastPersistedMode) return;
		this.lastPersistedMode = mode;
		try {
			this.onModeChanged?.(mode);
		} catch {
			// 持久化失败不影响内存态
		}
	}

	/** 是否存在挂起审批（compose 服务 setMode 延迟判定的探测面） */
	hasPendingApproval(): boolean {
		return this.pendingApprovals.size > 0;
	}

	/**
	 * 请求审批（无阻塞）：经 manager wait 通道提交 CMS 队列（request/resolve 分离），
	 * 返回决策 promise 供 gateBatch 驻留等待；决策经 resolveApproval 回传解除；
	 * 超时（waitTimeoutMs）按拒绝解除并触发 onWaitTimeout（子进程退出行为）。
	 * 不再经 output hub 发 approval 事件——wait 状态唯一权威是 CMS 队列。
	 * ExitComposeMode 包装：提交前 service.submit（designing→pending）；决议 approve →
	 * compose.approved 瞬态事件；reject/edit → designing + 晋升延迟 mode 目标。
	 */
	async sendApprovalRequest(req: ConversationApprovalRequest): Promise<ConversationApprovalDecision> {
		// ExitComposeMode：提交前 submit（designing→pending）。submit 内部全同步
		//（状态迁移 + 事件），先于队列注册完成，保证写序且不引入微任务竞态；
		// 异常兜底防 unhandledRejection（状态停在 designing，审批仍可进行）
		if (this.isExitComposeRequest(req) && this.composeService !== undefined) {
			void this.composeService.submit(this.conversationId, req.requestId).catch((error) => {
				this.logger.error("compose.submit_failed", {
					requestId: req.requestId,
					error: String(error),
				});
			});
		}
		// bypass 模式：用户已显式免审，直接放行（不进队列、不驻留等待）。
		// compose 激活期间 conversationMode === "compose" 不触发短路，Exit 走审批门；
		// 若 Exit 在 bypass 下触发（理论不在 compose 激活期），仍先驱动 compose 迁移再放行
		if (this.conversationMode === "bypass") {
			this.logger.info("approval.bypass_short_circuit", {
				requestId: req.requestId,
				toolNames: req.toolCalls.map((tc) => tc.toolName),
			});
			if (this.isExitComposeRequest(req) && this.composeService !== undefined) {
				await this.driveExitComposeDecision(req, { kind: "approve" });
			}
			return { kind: "approve" };
		}
		this.logger.info("approval.submitted", {
			requestId: req.requestId,
			toolNames: req.toolCalls.map((tc) => tc.toolName),
			mode: this.conversationMode,
		});
		return new Promise<ConversationApprovalDecision>((resolve) => {
			// 决议包装：先驱动 compose 状态迁移（写序），再解除 gateBatch 驻留；
			// 迁移失败不拦截决议送达（gateTool 等待方必须解除），错误现场落日志
			const settle = (decision: ConversationApprovalDecision): void => {
				void this.driveExitComposeDecision(req, decision).then(
					() => resolve(decision),
					(error) => {
						this.logger.error("approval.exit_drive_failed", {
							requestId: req.requestId,
							decision: decision.kind,
							error: String(error),
						});
						resolve(decision);
					},
				);
			};
			// 超时未启用（生产子进程）：不设定时器，驻留等待直到决策回传——
			// 提前超时会丢内存态（subagent/todo）且 UI 决策无法送达
			const timer = this.waitTimeoutEnabled
				? setTimeout(() => {
						this.pendingApprovals.delete(req.requestId);
						this.onWaitTimeout?.(req.requestId);
						settle({ kind: "reject" });
					}, this.waitTimeoutMs)
				: undefined;
			this.pendingApprovals.set(req.requestId, { resolve: settle, timer });
			if (this.managerWait !== undefined) {
				void this.managerWait
					.submitApproval(this.conversationId, req)
					.catch(() => {
						// 提交失败：立即按拒绝解除，避免悬挂
						const pending = this.pendingApprovals.get(req.requestId);
						if (pending === undefined) return;
						if (pending.timer !== undefined) clearTimeout(pending.timer);
						this.pendingApprovals.delete(req.requestId);
						settle({ kind: "reject" });
					});
			}
		});
	}

	/** 批量审批请求中是否含 ExitComposeMode（批量形态下按 toolCalls 识别） */
	private isExitComposeRequest(req: ConversationApprovalRequest): boolean {
		return req.toolCalls.some((tc) => tc.toolName === "ExitComposeMode");
	}

	/** ExitComposeMode 决议驱动：approve → compose.approved；reject/edit → designing + 晋升延迟目标 */
	private async driveExitComposeDecision(
		req: ConversationApprovalRequest,
		decision: ConversationApprovalDecision,
	): Promise<void> {
		if (!this.isExitComposeRequest(req) || this.composeService === undefined) return;
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
	async subscribeEvents(listener: ProjectedEventListener): Promise<void> {
		this.logger.debug("hub.subscribed", { listeners: this.eventListeners.size + 1 });
		this.eventListeners.add(listener);
	}

	/** 释放（清空订阅者 + 停止 subagent 任务） */
	dispose(): void {
		this.subagentRuntime?.stopAll();
		this.eventListeners.clear();
	}

	/** 解析待决审批（决策回传：CMS 经 rpc 调用；解除 gateBatch 的驻留等待） */
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

	/**
	 * 分发输出事件给所有订阅者（内存 hub + ZeroMQ 广播；事件盖 eseq 单调序号）。
	 * 逐订阅者保护：单个订阅者异常不阻断广播与其余订阅者。
	 */
	private emit(e: ProjectedEvent): void {
		const stamped = { ...e, eseq: ++this.eventSeq } as ProjectedEvent;
		for (const l of this.eventListeners) {
			try {
				l(stamped);
			} catch (error) {
				this.logger.warn("hub.listener_failed", { type: e.type, error: String(error) });
			}
		}
		this.eventPublisher?.publish(CONVERSATION_OUTPUT, {
			conversationId: this.conversationId,
			event: stamped,
		});
	}

	/**
	 * 状态事件出口（compose 服务 eventSink 装配目标）：写序 = ②persist 先落
	 * state.jsonl（appendFileSync 同步落盘）→ ③hub 广播；瞬态事件仅广播。
	 * append 无内部 await → void 调用同步完成、广播时序仍在其后；落盘失败经
	 * catch 记 state.persist_failed（广播照发，防 unhandledRejection 崩进程）。
	 * mode.changed 到达时同步去重写 meta.json（state.jsonl 是权威，meta.json 为镜像缓存）。
	 * @param e 状态事件（compose.* / mode.*）
	 */
	emitState(e: StateEvent): void {
		if ("persist" in e && e.persist) {
			void this.stateJournal?.append(e).catch((error) => {
				this.logger.error("state.persist_failed", {
					type: e.type,
					error: String(error),
				});
			});
		}
		if (e.type === "mode.changed") this.persistModeIfChanged(e.mode);
		this.emit(e);
	}

	/** 构造持久化回执（seq = run seq / journal lastSeq） */
	private receipt(seq: number): Receipt {
		return { seq, recordedAt: new Date().toISOString() };
	}
}
