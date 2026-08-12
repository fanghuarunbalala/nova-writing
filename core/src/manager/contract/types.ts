/**
 * manager 契约的共享类型：状态 / 元数据 / 摘要 / 引用。
 */

import type { AgentId, AgentType, ConversationId } from "../../conversation/contract/types/index.js";
import type { ConversationHandle } from "../../conversation/contract/handle/index.js";

/** conversation 运行状态 */
export type ConversationStatus = "active" | "stopped" | "crashed";

/** conversation 报到元数据（register 时提交） */
export interface ConversationMeta {
	/** conversation id（manager 分配） */
	conversationId: ConversationId;
	/** 会话名（UI 展示） */
	name: string;
	/** 会话 storedir 绝对路径 */
	storeDir: string;
	/** 绑定的主 agent id */
	agentId: AgentId;
	/** 派发的 agent 类型（spawn 时指派并确认） */
	agentType: AgentType;
	/** agent 定义版本 */
	agentVersion?: string;
	/** 派生者（teammate 有；root 无） */
	parentId?: ConversationId;
}

/** 会话摘要（list 返回） */
export interface ConversationSummary {
	conversationId: ConversationId;
	name: string;
	storeDir: string;
	status: ConversationStatus;
	parentId?: ConversationId;
}

/** 会话引用：spawnConversation / createOrResume 返回，含对端 handle */
export interface ConversationRef {
	/** conversation id */
	conversationId: ConversationId;
	/** 对端 handle（调用它的输入侧 + 订阅 hub + 应答） */
	handle: ConversationHandle;
}
