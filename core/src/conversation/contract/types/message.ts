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
