/** 用户消息携带的实体引用（五类，对齐 ui MessageReference 与 novel.system 标签语法） */
export interface ConversationReference {
	/** 引用类型：character / location / outline（故事单元）/ chapter / paragraph */
	kind: "character" | "location" | "outline" | "chapter" | "paragraph"
	/** 实体 id（paragraph = ParagraphId） */
	id: string
	/** 显示名（序列化为标签内文） */
	label: string
}

/** 用户消息 */
export interface ConversationUserMessage {
	/** 消息正文 */
	text: string
	/** 实体引用（可选）：入队前序列化为实体标签追加到 text（journal/回放/气泡 chips 零额外改动） */
	references?: readonly ConversationReference[]
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
