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
import type { ChildProcess } from "node:child_process";
import type {
	ConversationMeta,
	ConversationRef,
	ConversationStatus,
	ConversationSummary,
} from "../../manager/contract/types.js";
import type { ConversationManagerServer as Contract } from "../../manager/contract/server.js";
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

/** 进程派生器：spawn conversation 子进程（stdio），返回子进程 + wrap 的 handle */
export interface ConversationProcessSpawner {
	/**
	 * 派生 conversation 进程
	 * @param opts conversationId + agent 类型 + parentId
	 * @returns 子进程 + 对端 handle
	 */
	spawn(opts: { conversationId: string; agentType: string; parentId?: string }): {
		child: ChildProcess;
		handle: ConversationHandle;
	};
}

/** manager 进程侧实现（内存 factory 测试 / 进程 spawn 生产） */
export class ConversationManagerServer implements Contract {
	/** conversationId → Conversation 实例（内存模式） */
	private readonly conversations = new Map<string, Conversation>();
	/** conversationId → 操作目标（内存 Conversation / 进程 handle 统一） */
	private readonly handles = new Map<string, ConversationTarget>();
	/** conversationId → 子进程（进程模式） */
	private readonly childProcesses = new Map<string, ChildProcess>();
	/** conversationId → 摘要（目录） */
	private readonly summaries = new Map<string, ConversationSummary>();
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
	 */
	constructor(factory: ConversationFactory, spawner?: ConversationProcessSpawner) {
		this.factory = factory;
		this.spawner = spawner;
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

	/** 终止会话（进程模式 kill 子进程） */
	async terminate(conversationId: ConversationId): Promise<void> {
		this.childProcesses.get(conversationId)?.kill();
		this.childProcesses.delete(conversationId);
		const conv = this.conversations.get(conversationId);
		conv?.dispose();
		this.conversations.delete(conversationId);
		this.handles.delete(conversationId);
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
		if (this.spawner) {
			// 进程派生（生产）
			const { child, handle } = this.spawner.spawn({
				conversationId,
				agentType: opts.agentType,
				parentId: opts.parentId,
			});
			this.childProcesses.set(conversationId, child);
			this.handles.set(conversationId, handle);
			this.summaries.set(conversationId, {
				conversationId,
				name: conversationId,
				storeDir: "",
				status: "active",
				parentId: opts.parentId,
			});
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
			storeDir: "",
			status: "active",
			parentId: opts.parentId,
		});
		return { conversationId, handle: conversation };
	}

	/** 列出所有会话摘要 */
	async list(): Promise<ConversationSummary[]> {
		return [...this.summaries.values()];
	}

	/** 创建或恢复会话（内存版：无则新建） */
	async createOrResume(conversationId?: ConversationId): Promise<ConversationRef> {
		const id = conversationId ?? `conv_${++this.seq}`;
		let conversation = this.conversations.get(id);
		if (!conversation) {
			conversation = this.factory.create({ conversationId: id, agentType: "novel" });
			this.conversations.set(id, conversation);
			this.handles.set(id, conversation);
			this.summaries.set(id, { conversationId: id, name: id, storeDir: "", status: "active" });
		}
		return { conversationId: id, handle: conversation };
	}

	/** 删除会话 */
	async delete(conversationId: ConversationId): Promise<void> {
		this.childProcesses.get(conversationId)?.kill();
		this.childProcesses.delete(conversationId);
		this.conversations.get(conversationId)?.dispose();
		this.conversations.delete(conversationId);
		this.handles.delete(conversationId);
		this.summaries.delete(conversationId);
	}

	/** 转发消息到目标 conversation（按消息类型分派） */
	async sendMessageTo(conversationId: ConversationId, msg: ConversationMessage): Promise<Receipt> {
		const conv = this.require(conversationId);
		if ("text" in msg) return conv.sendUserMessage(msg);
		if ("name" in msg) return conv.sendUserCommand(msg);
		return conv.sendSystemControl(msg);
	}

	/** 转发审批请求（阻塞到决策） */
	async sendApprovalRequestTo(
		conversationId: ConversationId,
		req: ConversationApprovalRequest,
	): Promise<ConversationApprovalDecision> {
		return this.require(conversationId).sendApprovalRequest(req);
	}

	/** 转发提问请求（阻塞到回答） */
	async sendAskingRequestTo(
		conversationId: ConversationId,
		req: ConversationAskingRequest,
	): Promise<string> {
		return this.require(conversationId).sendAskingQuestionRequest(req);
	}

	/** 转发退出 compose 请求（阻塞到退出） */
	async sendExitComposeRequestTo(
		conversationId: ConversationId,
		req: ConversationExitComposeRequest,
	): Promise<void> {
		return this.require(conversationId).sendExitComposeRequest(req);
	}

	/** 取 conversation 操作目标，缺省抛错 */
	private require(id: ConversationId): ConversationTarget {
		const target = this.handles.get(id);
		if (!target) throw new Error(`未找到 conversation: ${id}`);
		return target;
	}
}
