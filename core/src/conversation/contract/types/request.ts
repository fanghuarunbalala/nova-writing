import type { RequestId } from "./id.js"

/** 审批请求（wait 请求侧，经 manager 路由到 parent） */
export interface ConversationApprovalRequest {
	/** 请求 id（与审批延迟 RPC 关联） */
	requestId: RequestId
	/** 待审批的 tool 名 */
	toolName: string
	/** tool 参数（JSON 字符串） */
	args: string
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
