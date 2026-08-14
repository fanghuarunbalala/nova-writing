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

/** 会话模式：review 需审批（默认）/ bypass 直接执行 / compose 设计模式 */
export type ConversationMode = "review" | "bypass" | "compose"

/** compose 模式相位：idle 空闲 / designing 设计中 / pending 待审批 / applied 已批准 / discarded 已放弃 */
export type ComposeModePhase = "idle" | "designing" | "pending" | "applied" | "discarded"

/** 默认会话模式 */
export const DEFAULT_CONVERSATION_MODE: ConversationMode = "review"

/** 系统控制（control lane，可抢占） */
export type ConversationSystemControl =
	| { type: "stop"; reason?: string }
	| { type: "reload.config" }
	/** 设置会话模式（经 manager 统一转发） */
	| { type: "mode.set"; mode: ConversationMode }

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
