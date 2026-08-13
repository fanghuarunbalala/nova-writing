/**
 * ConversationManagerHandle：UI / zygote 持有的 manager 客户端（wrap 侧）。
 * 只暴露 UI 需要的目录 + 生命周期子集；错误经 call 归一为 RPCError。
 */

import { dispose, wrap } from "kkrpc";
import type { RPCMessage, Transport } from "kkrpc";
import { call } from "../rpc/call.js";
import type {
	AgentType,
	ConversationId,
	ConversationMessage,
	Receipt,
} from "../conversation/contract/types/index.js";
import type { ConversationManagerServer } from "./contract/server.js";
import type { ConversationRef, ConversationSummary } from "./contract/types.js";

/** manager 客户端 handle（目录 / 生命周期 / 消息投递） */
export class ConversationManagerHandle {
	private readonly api: ConversationManagerServer;

	/**
	 * @param transport 传输（UI / zygote 到 manager 的连接）
	 */
	constructor(transport: Transport<RPCMessage>) {
		this.api = wrap<ConversationManagerServer>(transport);
	}

	/**
	 * 列出所有会话摘要（UI 目录）
	 * @returns 会话摘要列表
	 */
	async list(): Promise<ConversationSummary[]> {
		return call(() => this.api.list(), { peer: "manager" });
	}

	/**
	 * 创建或恢复会话（无 id → 新建并分配）
	 * @param conversationId 有 → resume/重连；无 → 新建
	 * @returns 会话引用（含对端 handle）
	 */
	async createOrResume(conversationId?: ConversationId): Promise<ConversationRef> {
		return call(() => this.api.createOrResume(conversationId), { peer: "manager" });
	}

	/**
	 * 派生会话（新 conversation 进程 / 内存）
	 * @param opts agentType + 可选版本/额外 prompt/parentId
	 * @returns 会话引用（含对端 handle）
	 */
	async spawnConversation(opts: {
		agentType: AgentType;
		agentVersion?: string;
		extraPrompt?: string;
		parentId?: ConversationId;
	}): Promise<ConversationRef> {
		return call(() => this.api.spawnConversation(opts), { peer: "manager" });
	}

	/**
	 * 删除会话
	 * @param conversationId 会话 id
	 */
	async delete(conversationId: ConversationId): Promise<void> {
		return call(() => this.api.delete(conversationId), { peer: "manager" });
	}

	/**
	 * 转发消息到目标会话（投递 user / command / control）
	 * @param conversationId 目标会话 id
	 * @param msg 会话消息
	 * @returns 受理回执
	 */
	async sendMessageTo(
		conversationId: ConversationId,
		msg: ConversationMessage,
	): Promise<Receipt> {
		return call(() => this.api.sendMessageTo(conversationId, msg), { peer: "manager" });
	}

	/** 释放 handle（断开通道） */
	dispose(): void {
		dispose(this.api);
	}
}
