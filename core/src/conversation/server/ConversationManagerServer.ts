/**
 * ConversationManagerServer 实现：manager 进程侧（内存版）。
 * 生命周期 + 目录 + 消息调度 + wait 请求路由。进程派生后续接 stdio/kkrpc transport。
 */
import type {
	ConversationId,
	ConversationMessage,
	ConversationApprovalDecision,
	ConversationApprovalRequest,
	ConversationAskingRequest,
	ConversationExitComposeRequest,
	Receipt,
} from "../contract/types/index.js";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import type {
	ConversationMeta,
	ConversationRef,
	ConversationStatus,
	ConversationSummary,
} from "../../manager/contract/types.js";
import type { ConversationManagerServer as Contract } from "../../manager/contract/server.js";
import { WaitRequestQueue, type ApprovalQueueItem } from "./WaitRequestQueue.js";
import type { Conversation } from "./Conversation.js";
import type { ConversationHandle } from "../contract/handle/index.js";
import type { ConversationInteraction } from "../contract/interaction/index.js";
import type { WaitingInteractionRequest } from "../contract/interaction/index.js";

/** conversation 操作目标（内存 Conversation / 进程 handle 统一接口） */
type ConversationTarget = ConversationInteraction & WaitingInteractionRequest;

/** conversation 工厂：给定 conversationId + agentType 创建 Conversation（上层装配注入） */
export interface ConversationFactory {
	/**
	 * 创建 conversation
	 * @param opts conversationId + agent 类型
	 * @returns Conversation 实例
	 */
	create(opts: { conversationId: string; agentType: string; parentId?: string }): Conversation;
}

/** 进程派生器：spawn conversation 子进程（manager WS 握手），返回子进程 + handle（连接报到后 resolve） */
export interface ConversationProcessSpawner {
	/**
	 * 派生 conversation 进程
	 * @param opts conversationId + agent 类型 + parentId + storedir（manager 分配，journal 落盘目录）+ workspace
	 * @returns 子进程 + 对端 handle（Promise：子进程经 manager WS register 连回后 resolve）
	 */
	spawn(opts: {
		conversationId: string;
		agentType: string;
		parentId?: string;
		storedir: string;
		workspace?: string;
	}): {
		child: ChildProcess;
		handle: Promise<ConversationHandle>;
	};
}

/** manager 服务端构造选项 */
export interface ConversationManagerServerOptions {
	/**
	 * 会话存储根目录（storedirRoot）。提供时：
	 * - 每个 conversation 分配 storedirRoot/<conversationId>/（journal 落盘目录）；
	 * - 构造时扫描目录种子 catalog（重启恢复）；
	 * - 崩溃后 createOrResume 用同一 storedir 重派生（子进程 journal 重放续跑）。
	 */
	storedirRoot?: string;
	/**
	 * 当前工作区根路径提供器（spawn 时求值，经 env NOVEL_CONVERSATION_WORKSPACE 注入子进程；
	 * 缺省子进程用 "."）。
	 */
	workspaceProvider?: () => string | undefined;
}

/** manager 进程侧实现（内存 factory 测试 / 进程 spawn 生产） */
export class ConversationManagerServer implements Contract {
	/** conversationId → Conversation 实例（内存模式） */
	private readonly conversations = new Map<string, Conversation>();
	/** conversationId → 操作目标（内存 Conversation / 进程 handle 统一，均为 ConversationHandle） */
	private readonly handles = new Map<string, ConversationHandle>();
	/** conversationId → 子进程（进程模式） */
	private readonly childProcesses = new Map<string, ChildProcess>();
	/** conversationId → 摘要（目录） */
	private readonly summaries = new Map<string, ConversationSummary>();
	/** 主动终止的会话 id（exit 事件据此区分 crashed / stopped） */
	private readonly terminatedIds = new Set<string>();
	/** wait 请求队列（request/resolve 分离的缓冲层） */
	private readonly waitQueue = new WaitRequestQueue();
	/** 会话存储根目录（undefined = 不落盘目录，storedir 为空串） */
	private readonly storedirRoot?: string;
	/** 当前工作区根路径提供器（spawn 时求值） */
	private readonly workspaceProvider?: () => string | undefined;
	/** id 递增 */
	private seq = 0;
	/** conversation 工厂（内存模式） */
	private readonly factory: ConversationFactory;
	/** 进程派生器（进程模式；缺省用内存 factory） */
	private readonly spawner?: ConversationProcessSpawner;

	/**
	 * 构造 ManagerServer
	 * @param factory conversation 工厂（内存模式，上层装配注入）
	 * @param spawner 进程派生器（进程模式；缺省用 factory 内存）
	 * @param opts 可选配置（storedirRoot：会话存储根目录，含目录扫描恢复）
	 */
	constructor(
		factory: ConversationFactory,
		spawner?: ConversationProcessSpawner,
		opts?: ConversationManagerServerOptions,
	) {
		this.factory = factory;
		this.spawner = spawner;
		this.storedirRoot = opts?.storedirRoot;
		this.workspaceProvider = opts?.workspaceProvider;
		if (this.storedirRoot !== undefined) this.scanCatalog();
	}

	/** 会话存储目录（storedirRoot 未提供时为空串；id 全局唯一，目录确定性可重派生复用） */
	private allocStoredir(conversationId: string): string {
		return this.storedirRoot !== undefined ? join(this.storedirRoot, conversationId) : "";
	}

	/** 扫描 storedirRoot 种子 catalog（重启恢复）：目录名 = conversationId，status:"stopped"，seq 取 conv_<n> 最大值防 id 撞车 */
	private scanCatalog(): void {
		if (this.storedirRoot === undefined || !existsSync(this.storedirRoot)) return;
		for (const entry of readdirSync(this.storedirRoot, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const conversationId = entry.name;
			this.summaries.set(conversationId, {
				conversationId,
				name: conversationId,
				storeDir: this.allocStoredir(conversationId),
				status: "stopped",
			});
			const match = /^conv_(\d+)$/.exec(conversationId);
			if (match) this.seq = Math.max(this.seq, Number(match[1]));
		}
	}

	/** 挂子进程 exit 监听：主动终止（terminatedIds）→ 清记录置 stopped；否则标记 crashed（summary 保留供 createOrResume 重派生） */
	private attachExit(conversationId: ConversationId, child: ChildProcess): void {
		child.once("exit", () => {
			const summary = this.summaries.get(conversationId);
			if (this.terminatedIds.has(conversationId)) {
				this.terminatedIds.delete(conversationId);
				if (summary) summary.status = "stopped";
			} else if (summary) {
				summary.status = "crashed";
			}
			// 进程退出：pending wait 条目标记过期（重启补完按超时拒绝处理）
			this.waitQueue.expireConversation(conversationId, new Date().toISOString());
			this.childProcesses.delete(conversationId);
			this.handles.delete(conversationId);
		});
	}

	/** conversation 启动报到 */
	async register(meta: ConversationMeta): Promise<void> {
		this.summaries.set(meta.conversationId, {
			conversationId: meta.conversationId,
			name: meta.name,
			storeDir: meta.storeDir,
			status: "active",
			parentId: meta.parentId,
		});
	}

	/** 心跳上报状态 */
	async heartbeat(conversationId: ConversationId, status: ConversationStatus): Promise<void> {
		const s = this.summaries.get(conversationId);
		if (s) s.status = status;
	}

	/** 终止会话（进程模式 kill 子进程，保留目录；exit 事件置 stopped；pending wait 标记过期） */
	async terminate(conversationId: ConversationId): Promise<void> {
		const child = this.childProcesses.get(conversationId);
		if (child !== undefined) {
			this.terminatedIds.add(conversationId);
			child.kill();
		}
		this.childProcesses.delete(conversationId);
		const conv = this.conversations.get(conversationId);
		conv?.dispose();
		this.conversations.delete(conversationId);
		this.handles.delete(conversationId);
		// pending wait 条目标记过期（重启补完按超时拒绝处理）
		this.waitQueue.expireConversation(conversationId, new Date().toISOString());
		const s = this.summaries.get(conversationId);
		if (s) s.status = "stopped";
	}

	/** 派生 conversation（进程 spawn 优先，缺省内存 factory） */
	async spawnConversation(opts: {
		agentType: string;
		agentVersion?: string;
		extraPrompt?: string;
		parentId?: ConversationId;
	}): Promise<ConversationRef> {
		const conversationId = `conv_${++this.seq}`;
		const storedir = this.allocStoredir(conversationId);
		if (this.spawner) {
			// 进程派生（生产）：manager 分配 storedir，等子进程 manager WS 报到后登记 handle
			const { child, handle: handlePromise } = this.spawner.spawn({
				conversationId,
				agentType: opts.agentType,
				parentId: opts.parentId,
				storedir,
				workspace: this.workspaceProvider?.(),
			});
			this.childProcesses.set(conversationId, child);
			this.summaries.set(conversationId, {
				conversationId,
				name: conversationId,
				storeDir: storedir,
				status: "active",
				parentId: opts.parentId,
			});
			this.attachExit(conversationId, child);
			const handle = await handlePromise;
			this.handles.set(conversationId, handle);
			return { conversationId, handle };
		}
		// 内存（测试）
		const conversation = this.factory.create({
			conversationId,
			agentType: opts.agentType,
			parentId: opts.parentId,
		});
		this.conversations.set(conversationId, conversation);
		this.handles.set(conversationId, conversation);
		this.summaries.set(conversationId, {
			conversationId,
			name: conversationId,
			storeDir: storedir,
			status: "active",
			parentId: opts.parentId,
		});
		return { conversationId, handle: conversation };
	}

	/** 列出所有会话摘要 */
	async list(): Promise<ConversationSummary[]> {
		return [...this.summaries.values()];
	}

	/** 创建或恢复会话（spawner 可用时派生/复用子进程，否则内存新建） */
	async createOrResume(conversationId?: ConversationId): Promise<ConversationRef> {
		const id = conversationId ?? `conv_${++this.seq}`;
		if (this.spawner) {
			// 进程模式：子进程存活则复用；已死（crashed/未派生）用同一 storedir 重派生，子进程经 journal 重放续跑
			let handle = this.handles.get(id);
			const existingChild = this.childProcesses.get(id);
			if (handle === undefined || existingChild === undefined || existingChild.exitCode !== null) {
				const storedir = this.allocStoredir(id);
				const { child, handle: spawnedPromise } = this.spawner.spawn({
					conversationId: id,
					agentType: "novel",
					storedir,
					workspace: this.workspaceProvider?.(),
				});
				this.childProcesses.set(id, child);
				this.summaries.set(id, { conversationId: id, name: id, storeDir: storedir, status: "active" });
				this.attachExit(id, child);
				handle = await spawnedPromise;
				this.handles.set(id, handle);
			}
			return { conversationId: id, handle };
		}
		let conversation = this.conversations.get(id);
		if (!conversation) {
			conversation = this.factory.create({ conversationId: id, agentType: "novel" });
			this.conversations.set(id, conversation);
			this.handles.set(id, conversation);
			this.summaries.set(id, {
				conversationId: id,
				name: id,
				storeDir: this.allocStoredir(id),
				status: "active",
			});
		}
		return { conversationId: id, handle: conversation };
	}

	/** 删除会话（kill 子进程 + 删目录；Windows 下刚 kill 的子进程句柄可能短暂占用目录，删除失败忽略） */
	async delete(conversationId: ConversationId): Promise<void> {
		const child = this.childProcesses.get(conversationId);
		if (child !== undefined) {
			this.terminatedIds.add(conversationId);
			child.kill();
		}
		this.childProcesses.delete(conversationId);
		this.conversations.get(conversationId)?.dispose();
		this.conversations.delete(conversationId);
		this.handles.delete(conversationId);
		this.summaries.delete(conversationId);
		this.waitQueue.clearConversation(conversationId);
		if (this.storedirRoot !== undefined) {
			try {
				rmSync(this.allocStoredir(conversationId), { recursive: true, force: true });
			} catch {
				// 目录暂被占用（Windows 子进程句柄），残留目录无副作用，忽略
			}
		}
	}

	/** 转发消息到目标 conversation（按消息类型分派） */
	async sendMessageTo(conversationId: ConversationId, msg: ConversationMessage): Promise<Receipt> {
		const conv = this.require(conversationId);
		if ("text" in msg) return conv.sendUserMessage(msg);
		if ("name" in msg) return conv.sendUserCommand(msg);
		return conv.sendSystemControl(msg);
	}

	/** 提交审批请求（非阻塞）：入队 + decisioner 派生（parentId → parent 冒泡预留；否则 ui） */
	async submitApprovalRequest(
		conversationId: ConversationId,
		req: ConversationApprovalRequest,
	): Promise<void> {
		const parentId = this.summaries.get(conversationId)?.parentId;
		this.waitQueue.submit({
			conversationId,
			requestId: req.requestId,
			toolName: req.toolName,
			args: req.args,
			decisioner: parentId !== undefined ? "parent" : "ui",
			status: "pending",
			requestedAt: new Date().toISOString(),
		});
	}

	/** 提交提问请求（非阻塞；路由同审批，UI 展示延后——本期内入队仅登记） */
	async submitAskingRequest(
		_conversationId: ConversationId,
		_req: ConversationAskingRequest,
	): Promise<void> {
		// 提问/退出 compose 与审批同一路由；UI 面板延后，队列登记后续接入
	}

	/** 提交退出 compose 请求（非阻塞；路由同审批） */
	async submitExitComposeRequest(
		_conversationId: ConversationId,
		_req: ConversationExitComposeRequest,
	): Promise<void> {
		// 见 submitAskingRequest
	}

	/** 待 UI 决策的审批列表（decisioner="ui"） */
	async listApprovals(): Promise<readonly ApprovalQueueItem[]> {
		return this.waitQueue.list();
	}

	/** 记录 UI 决策：驻留会话直推 resolveApproval，已退出留待重启查询 */
	async resolveApproval(requestId: string, decision: ConversationApprovalDecision): Promise<boolean> {
		const resolved = this.waitQueue.resolve(requestId, decision, new Date().toISOString());
		if (!resolved) return false;
		// 驻留直推：会话存活则经 handle 调 conversation 的 resolveApproval（阻塞解除）
		const item = this.waitQueue.takeByRequestId(requestId);
		if (item !== undefined) {
			const handle = this.handles.get(item.conversationId);
			if (handle !== undefined) {
				// fire-and-forget：进程内实现返回 void，远程代理返回 Promise（契约类型为 void）。
				// child 已退出时通道拒绝属预期（决策已入 waitQueue，重启经 takeDecisions 续跑），
				// 吞掉避免 main 进程 unhandled rejection
				try {
					void Promise.resolve(handle.resolveApproval(requestId, decision) as unknown).catch(() => {});
				} catch {
					// 代理同步抛错（通道已关）同属预期，忽略
				}
			}
		}
		return true;
	}

	/** 子进程重启查询：该会话的待决/已决条目（暂停点续跑） */
	async takeDecisions(conversationId: ConversationId): Promise<readonly ApprovalQueueItem[]> {
		return this.waitQueue.take(conversationId);
	}

	/** 订阅队列变化（main 侧转发 UI 通知） */
	onWaitChange(listener: () => void): () => void {
		return this.waitQueue.onChange(listener);
	}

	/** 取 conversation 操作目标，缺省抛错 */
	private require(id: ConversationId): ConversationTarget {
		const target = this.handles.get(id);
		if (!target) throw new Error(`未找到 conversation: ${id}`);
		return target;
	}
}
