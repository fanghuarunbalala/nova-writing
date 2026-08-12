/**
 * 事件 topic 与地址约定（ZeroMQ PUB/SUB）。
 * 地址 ipc:// = Windows 命名管道；一个地址一个 PUB 绑定，多个 SUB 可连（广播）。
 */

/** novel.changed 变更事件 topic */
export const NOVEL_CHANGED = "novel.changed"

/** conversation 输出事件 topic（assistant 消息 / delta / todo 等） */
export const CONVERSATION_OUTPUT = "conversation.output"

/** novel-db 事件 PUB 地址（固定，env 可覆盖） */
export const NOVEL_EVENTS_ADDR = process.env.NOVEL_EVENTS_ADDR ?? "ipc://novel-events"

/**
 * conversation 输出事件 PUB 地址（按 conversationId 派生，全局唯一）
 * @param conversationId 会话 id
 * @returns ZeroMQ 地址
 */
export function conversationEventsAddr(conversationId: string): string {
	return `ipc://conversation-${conversationId}-events`
}
