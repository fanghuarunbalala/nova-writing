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
	/** 请求 id（与审批延迟 RPC 关联；approval:{convId}:{runSeq}:b{batchSeq}） */
	requestId: RequestId
	/** 待审批的工具调用（≥1 项；决策作用于整批） */
	toolCalls: readonly ConversationApprovalToolCall[]
}

/** 提问选项（AskUserQuestion 选择题候选；description 支持 markdown 渲染） */
export interface AskOptionSpec {
	/** 选项显示文本（简短；推荐项放首位并在末尾加「（推荐）」） */
	label: string
	/** 选项含义 / 选中后的影响（markdown） */
	description: string
}

/** 提问问题（选择题 = options 2-4 个 + UI 恒有「其他」自填；开放填空 = 省略 options） */
export interface AskQuestionSpec {
	/** 完整问题（纯文本，以问号结尾） */
	question: string
	/** 极短标签（≤6 汉字），UI 显示为芯片 */
	header: string
	/** md 引导块（问题上方渲染：背景、灵感方向简述、示例） */
	context?: string
	/** 候选选项（给出则 2-4 个、同问内 label 唯一；省略 = 开放填空题） */
	options?: AskOptionSpec[]
	/** 开放题输入提示（纯文本） */
	placeholder?: string
	/** true 时允许多选（选项不互斥；仅选择题有意义） */
	multiSelect?: boolean
}

/** 单个问题的作者回答（selections 为空 + skipped=true 表示跳过） */
export interface AskQuestionAnswer {
	/** 对应 AskQuestionSpec.question（回填匹配用） */
	question: string
	/** 选中的选项 label（开放题为空数组；「其他」不产生 label） */
	selections: string[]
	/** 「其他」自填 / 开放题回答文本 */
	text?: string
	/** 作者跳过该问 */
	skipped?: boolean
}

/** 提问请求（wait 请求侧，经 manager 路由到 parent） */
export interface ConversationAskingRequest {
	/** 请求 id（ask:{conversationId}:{短码}） */
	requestId: RequestId
	/** 问题列表（1-4 个，可混排选择题与开放题） */
	questions: readonly AskQuestionSpec[]
}

/** 退出 compose 请求（wait 请求侧，经 manager 路由到 parent） */
export interface ConversationExitComposeRequest {
	/** 请求 id */
	requestId: RequestId
	/** 退出原因 */
	reason?: string
}
