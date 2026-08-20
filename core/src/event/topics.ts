/**
 * 事件 topic 与地址约定（ZeroMQ PUB/SUB）。
 * 地址 ipc:// = Windows 命名管道；一个地址一个 PUB 绑定，多个 SUB 可连（广播）。
 */

/** novel.changed 变更事件 topic */
export const NOVEL_CHANGED = "novel.changed"

/** conversation 输出事件 topic（assistant 消息 / delta / todo 等） */
export const CONVERSATION_OUTPUT = "conversation.output"

/**
 * novel-db 事件 PUB 地址：默认按进程 pid 唯一（多 GUI 实例并行各自 bind 不冲突；
 * PUB bind 与 SUB connect 均在 GUI main 进程内装配，pid 天然一致）。
 * env 显式设置仅单实例调试用——多实例下手动设置会撞地址。
 */
export function novelEventsAddr(): string {
	return process.env.NOVEL_EVENTS_ADDR ?? `ipc://novel-events-${process.pid}`
}

/**
 * conversation 输出事件 PUB 地址（按 conversationId 派生）。
 * 多 GUI 实例并行时拼入实例命名空间（env NOVEL_EVENT_NAMESPACE）：GUI main 启动时设为
 * 自身 pid，会话子进程经 spawn env 继承同值——两侧进程 pid 不同，只能经 env 对齐；
 * 未设置（单进程/测试）保持原地址形态。
 * @param conversationId 会话 id
 * @returns ZeroMQ 地址
 */
export function conversationEventsAddr(conversationId: string): string {
	const ns = process.env.NOVEL_EVENT_NAMESPACE
	return ns !== undefined && ns !== ""
		? `ipc://conversation-${ns}-${conversationId}-events`
		: `ipc://conversation-${conversationId}-events`
}

/**
 * 焦点回切通道地址：同项目双开时，挑战实例 → 持有实例「把主窗口切到前台」。
 * 按 workspaceId 派生（根路径确定性哈希，两实例对同一项目算出同值）。
 * @param workspaceId 工作区 id
 * @returns ZeroMQ 地址
 */
export function workspaceFocusAddr(workspaceId: string): string {
	return `ipc://novel-focus-${workspaceId}`
}
