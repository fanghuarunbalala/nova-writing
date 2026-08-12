/**
 * ConversationManagerServer 契约：统一管理 conversation 的进程。
 * 只做：生命周期 + 目录 + 消息调度。进度 / 事件 / 流式不经过它。
 * 调用方：conversation 用生命周期 + 消息调度（sendMessageTo / send*RequestTo）；UI / zygote 用目录。
 * wait 请求经 send*RequestTo 路由到 parent，由 parent 逻辑决定下一步。
 */

import type {
	AgentType,
	ConversationApprovalDecision,
	ConversationApprovalRequest,
	ConversationAskingRequest,
	ConversationExitComposeRequest,
	ConversationId,
	ConversationMessage,
	Receipt,
} from "../../conversation/contract/types/index.js";
import type {
	ConversationMeta,
	ConversationRef,
	ConversationStatus,
	ConversationSummary,
} from "./types.js";

/** ConversationManagerServer —— 统一管理 conversation 的进程契约 */
export interface ConversationManagerServer {
	/**
	 * conversation 启动时报到
	 * @param meta 会话元数据
	 */
	register(meta: ConversationMeta): Promise<void>;
	/**
	 * 心跳上报状态
	 * @param conversationId 会话 id
	 * @param status 当前状态
	 */
	heartbeat(conversationId: ConversationId, status: ConversationStatus): Promise<void>;
	/**
	 * 终止会话（终止进程；storedir 由 delete 决定去留）
	 * @param conversationId 会话 id
	 */
	terminate(conversationId: ConversationId): Promise<void>;
	/**
	 * 派生 teammate（新 conversation 进程）
	 * @param opts 派生选项
	 * @returns 会话引用（含对端 handle）
	 */
	spawnConversation(opts: {
		/** 指派并确认的 agent 类型 */
		agentType: AgentType;
		/** agent 定义版本 */
		agentVersion?: string;
		/** 额外 prompt（叠加在 agent 定义的系统提示之上） */
		extraPrompt?: string;
		parentId?: ConversationId;
	}): Promise<ConversationRef>;
	/**
	 * 列出所有会话摘要（UI 目录）
	 * @returns 会话摘要列表
	 */
	list(): Promise<ConversationSummary[]>;
	/**
	 * 创建或恢复会话
	 * @param conversationId 有 → resume/重连；无 → 新建并分配（层级 id）
	 * @returns 会话引用（含对端 handle）
	 */
	createOrResume(conversationId?: ConversationId): Promise<ConversationRef>;
	/**
	 * 删除会话（含 storedir 归档/清理）
	 * @param conversationId 会话 id
	 */
	delete(conversationId: ConversationId): Promise<void>;
	/**
	 * 转发消息到目标会话（调用其 ConversationInteraction 投递）
	 * @param conversationId 目标会话 id
	 * @param msgs 会话消息（user / command / control）
	 * @returns 受理回执
	 */
	sendMessageTo(
		conversationId: ConversationId,
		msgs: ConversationMessage
	): Promise<Receipt>;
	/**
	 * 转发审批请求：查图后调用目标 conversation 的 WaitingInteractionRequest.sendApprovalRequest 投递，
	 * 阻塞到决策返回
	 * @param conversationId 目标会话 id
	 * @param req 审批请求
	 * @returns 审批决策（延迟 RPC 的返回值）
	 */
	sendApprovalRequestTo(
		conversationId: ConversationId,
		req: ConversationApprovalRequest
	): Promise<ConversationApprovalDecision>;
	/**
	 * 转发提问请求：调用目标 conversation 的 WaitingInteractionRequest.sendAskingQuestionRequest 投递，
	 * 阻塞到回答返回
	 * @param conversationId 目标会话 id
	 * @param req 提问请求
	 * @returns 用户回答文本
	 */
	sendAskingRequestTo(
		conversationId: ConversationId,
		req: ConversationAskingRequest
	): Promise<string>;
	/**
	 * 转发退出 compose 请求：调用目标 conversation 的 WaitingInteractionRequest.sendExitComposeRequest 投递，
	 * 阻塞到退出完成
	 * @param conversationId 目标会话 id
	 * @param req 退出请求
	 * @returns 完成
	 */
	sendExitComposeRequestTo(
		conversationId: ConversationId,
		req: ConversationExitComposeRequest
	): Promise<void>;
}
