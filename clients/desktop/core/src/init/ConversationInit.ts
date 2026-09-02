/**
 * conversation 进程入口：统一启动 conversation（peers 依赖注入 + expose）。
 * 对齐 architecture.md 第 4 节：所有 conversation 构造一致，peers 统一 { manager, ui, novel }。
 */
import { expose, type ExposedController } from "kkrpc";
import type { RPCMessage, Transport } from "kkrpc";
import type { Conversation } from "../conversation/server/Conversation.js";

/** conversation 进程环境 */
export interface ConversationEnv {
	/** conversation id（manager 分配） */
	conversationId: string;
	/** 主 agent id（main） */
	agentId: string;
	/** storedir 绝对路径 */
	storedir: string;
	/** 派生者（teammate 有；root 无） */
	parentId?: string;
}

/** conversation 进程对端 */
export interface ConversationPeers {
	/** manager 通道（生命周期 + 消息调度） */
	manager: Transport<RPCMessage>;
	/** ui 通道（输入 rpc + output hub） */
	ui: Transport<RPCMessage>;
	/** novel 通道（client-only） */
	novel: Transport<RPCMessage>;
}

/**
 * 启动 conversation 进程：expose Conversation 到传输。
 * @param conversation 会话实例（上层用 peers 装配）
 * @param transport 暴露的传输（stdio / 测试内存）
 * @returns expose 控制器（关闭用）
 */
export async function runConversation(
	conversation: Conversation,
	transport: Transport<RPCMessage>,
): Promise<ExposedController> {
	return expose(conversation, transport);
}
