import type { RequestId } from "./id.js"

/** 审批请求中的待审工具调用（一批 = 同一次模型返回的全部待审调用） */
export interface ConversationApprovalToolCall {
	/** 工具调用 id（恢复匹配用） */
	toolCallId: string
	/** tool 名 */
	toolName: string
	/** tool 参数（JSON 字符串） */
	args: string
}

/** 审批请求（wait 请求侧，经 manager 路由到 parent；按 turn 批量） */
export interface ConversationApprovalRequest {
	/** 请求 id（与审批延迟 RPC 关联；approval:{convId}:{turnSeq}:b{batchSeq}） */
	requestId: RequestId
	/** 待审批的工具调用（≥1 项；决策作用于整批） */
	toolCalls: readonly ConversationApprovalToolCall[]
}

/** 提问请求（wait 请求侧，经 manager 路由到 parent） */
export interface ConversationAskingRequest {
	/** 请求 id */
	requestId: RequestId
	/** 问题列表 */
	questions: string[]
}

/** 退出 compose 请求（wait 请求侧，经 manager 路由到 parent） */
export interface ConversationExitComposeRequest {
	/** 请求 id */
	requestId: RequestId
	/** 退出原因 */
	reason?: string
}
