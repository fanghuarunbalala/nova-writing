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
import type {
	ConversationMeta,
	ConversationRef,
	ConversationStatus,
	ConversationSummary,
} from "../../manager/contract/types.js";
import type { ConversationManagerServer as Contract } from "../../manager/contract/server.js";
import type { Conversation } from "./Conversation.js";

/** conversation 工厂：给定 conversationId + agentType 创建 Conversation（上层装配注入） */
export interface ConversationFactory {
	/**
	 * 创建 conversation
	 * @param opts conversationId + agent 类型
	 * @returns Conversation 实例
	 */
	create(opts: { conversationId: string; agentType: string; parentId?: string }): Conversation;
}

/** manager 进程侧实现（内存版：conversation 同进程，后续拆进程） */
export class ConversationManagerServer implements Contract {
	/** conversationId → Conversation 实例 */
	private readonly conversations = new Map<string, Conversation>();
	/** conversationId → 摘要（目录） */
	private readonly summaries = new Map<string, ConversationSummary>();
	/** id 递增 */
	private seq = 0;
	/** conversation 工厂 */
	private readonly factory: ConversationFactory;

	/**
	 * 构造 ManagerServer
	 * @param factory conversation 工厂（上层装配注入）
	 */
	constructor(factory: ConversationFactory) {
		this.factory = factory;
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

	/** 终止会话 */
	async terminate(conversationId: ConversationId): Promise<void> {
		const conv = this.conversations.get(conversationId);
		conv?.dispose();
		this.conversations.delete(conversationId);
		const s = this.summaries.get(conversationId);
		if (s) s.status = "stopped";
	}

	/** 派生 conversation（内存版：同进程创建 Conversation） */
	async spawnConversation(opts: {
		agentType: string;
		agentVersion?: string;
		extraPrompt?: string;
		parentId?: ConversationId;
	}): Promise<ConversationRef> {
		const conversationId = `conv_${++this.seq}`;
		const conversation = this.factory.create({
			conversationId,
			agentType: opts.agentType,
			parentId: opts.parentId,
		});
		this.conversations.set(conversationId, conversation);
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
			this.summaries.set(id, { conversationId: id, name: id, storeDir: "", status: "active" });
		}
		return { conversationId: id, handle: conversation };
	}

	/** 删除会话 */
	async delete(conversationId: ConversationId): Promise<void> {
		this.conversations.get(conversationId)?.dispose();
		this.conversations.delete(conversationId);
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

	/** 取 conversation，缺省抛错 */
	private require(id: ConversationId): Conversation {
		const conv = this.conversations.get(id);
		if (!conv) throw new Error(`未找到 conversation: ${id}`);
		return conv;
	}
}
