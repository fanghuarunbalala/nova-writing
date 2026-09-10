/** Conversation 唯一标识（ConversationManagerServer 分配，层级命名空间） */
export type ConversationId = string

/** Agent 唯一标识（绑定在 conversation 上；subagent 在其 conversation 内标记） */
export type AgentId = string

/** 审批/提问等请求的关联 id（请求事件与应答之间用 requestId 关联） */
export type RequestId = string

/** Agent 类型（决定 agent 的定义/能力；具体枚举由 agent 目录定义） */
export type AgentType = string
