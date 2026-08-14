/**
 * ConversationManagerServer 契约：统一管理 conversation 的进程。
 * 只做：生命周期 + 目录 + 消息调度 + wait 队列路由。进度 / 事件 / 流式不经过它。
 * wait 语义（request/resolve 分离，无阻塞）：conversation 非阻塞提交 → 队列记录 →
 * UI（root 的决策者）拉取列表并 resolve → CMS 记录决策并直推驻留 conversation 的
 * resolveApproval（或已退出则留待重启后 takeDecisions 查询续跑）；teammate 的请求
 * 决策者 = parent（冒泡路由，接口预留）。
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
import type { ApprovalQueueItem } from "../../conversation/server/WaitRequestQueue.js";
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
	 * 重命名会话：更新目录摘要并持久化（storedir/meta.json；重启扫描恢复）。
	 * @param conversationId 会话 id
	 * @param name 新名字（trim 后非空；显式名优先于 journal 首句派生）
	 * @returns 是否命中会话（false = 会话不存在或名字为空）
	 */
	rename(conversationId: ConversationId, name: string): Promise<boolean>;
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
	 * 提交审批请求（非阻塞）：入队等待决策；decisioner 按会话 parentId 派生
	 * （teammate → parent 冒泡预留；root → ui）。
	 * @param conversationId 发起会话 id
	 * @param req 审批请求
	 */
	submitApprovalRequest(conversationId: ConversationId, req: ConversationApprovalRequest): Promise<void>;
	/**
	 * 提交提问请求（非阻塞；路由同审批，UI 展示延后）
	 * @param conversationId 发起会话 id
	 * @param req 提问请求
	 */
	submitAskingRequest(conversationId: ConversationId, req: ConversationAskingRequest): Promise<void>;
	/**
	 * 提交退出 compose 请求（非阻塞；路由同审批）
	 * @param conversationId 发起会话 id
	 * @param req 退出请求
	 */
	submitExitComposeRequest(conversationId: ConversationId, req: ConversationExitComposeRequest): Promise<void>;
	/**
	 * 待 UI 决策的审批列表（decisioner="ui"；含近期已决条目供面板展示）
	 * @returns 队列条目（按提交时间倒序）
	 */
	listApprovals(): Promise<readonly ApprovalQueueItem[]>;
	/**
	 * 记录 UI 决策：驻留中的会话直推其 resolveApproval（rpc 调用），
	 * 已退出的会话留待重启后经 takeDecisions 查询续跑。
	 * @param requestId 请求 id
	 * @param decision 决策（approve / reject / edit+意见）
	 * @returns 是否命中待决条目
	 */
	resolveApproval(requestId: string, decision: ConversationApprovalDecision): Promise<boolean>;
	/**
	 * 子进程重启查询：该会话的待决/已决条目（暂停点续跑用）
	 * @param conversationId 会话 id
	 * @returns 队列条目
	 */
	takeDecisions(conversationId: ConversationId): Promise<readonly ApprovalQueueItem[]>;
	/**
	 * 订阅队列变化（main 侧注册：转发 UI 的 onApprovalsChanged 通知）
	 * @param listener 变化回调
	 * @returns 取消订阅函数
	 */
	onWaitChange(listener: () => void): () => void;
}
