/**
 * conversation 域共享基础类型。
 * 纯类型契约：全进程共享，无实现、无运行时依赖。
 */

/** Conversation 唯一标识（ConversationManagerServer 分配，层级命名空间） */
export type ConversationId = string

/** Agent 唯一标识（绑定在 conversation 上；subagent 在其 conversation 内标记） */
export type AgentId = string

/** 审批/提问等请求的关联 id（请求事件与应答之间用 requestId 关联） */
export type RequestId = string

/** Agent 类型（决定 agent 的定义/能力；具体枚举由 agent 目录定义） */
export type AgentType = string

/**
 * 输入 rpc 的持久化回执：事件落 journal 后返回。
 * 注意：回执是"已持久化（seq）"，不是"处理完成"；处理异步进行，产物走输出通道。
 */
export interface Receipt {
	/** journal 序列号 */
	seq: number
	/** 记录时间 */
	recordedAt: string
}

/** 用户消息 */
export interface ConversationUserMessage {
	/** 消息正文 */
	text: string
}

/** 用户命令（turn lane，agent 可见） */
export interface ConversationUserCommand {
	/** 命令名 */
	name: string
	/** 命令参数 */
	args?: Record<string, unknown>
}

/** 系统控制（control lane，可抢占） */
export type ConversationSystemControl =
	| { type: "stop"; reason?: string }
	| { type: "reload.config" }

/** 可投递给 conversation 的消息（manager.sendMessageTo 的载荷） */
export type ConversationMessage =
	| ConversationUserMessage
	| ConversationUserCommand
	| ConversationSystemControl

/** 审批决策 */
export type ConversationApprovalDecision =
	| { kind: "approve" }
	| { kind: "reject" }
	| { kind: "edit"; text: string }

/** 审批请求（wait 请求侧，经 manager 路由到 parent） */
export interface ConversationApprovalRequest {
	/** 请求 id（与 approval.decision 关联） */
	requestId: RequestId
	/** 待审批的 tool 名 */
	toolName: string
	/** tool 参数（JSON 字符串） */
	args: string
}

/** 提问请求（wait 请求侧，经 manager 路由到 parent） */
export interface ConversationAskingRequest {
	/** 请求 id（与 question.answer 关联） */
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
