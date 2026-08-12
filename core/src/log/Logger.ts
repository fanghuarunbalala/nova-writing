/**
 * 平台无关 Logger 契约：event 名为主键 + 结构化字段。
 * 后端可插拔（pino 等）；各进程通过 createLogger 获得实例，子 logger 绑定常驻字段。
 */

/** 结构化日志字段（JSON-safe，pino 序列化） */
export type LogFields = Record<string, unknown>

/** 日志级别（对齐 pino） */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error"

/** 平台无关 Logger 契约 */
export interface Logger {
	/**
	 * trace 级日志
	 * @param event 事件名（日志主键，如 "conversation.spawned"）
	 * @param fields 结构化字段
	 */
	trace(event: string, fields?: LogFields): void
	/**
	 * debug 级日志
	 * @param event 事件名
	 * @param fields 结构化字段
	 */
	debug(event: string, fields?: LogFields): void
	/**
	 * info 级日志
	 * @param event 事件名
	 * @param fields 结构化字段
	 */
	info(event: string, fields?: LogFields): void
	/**
	 * warn 级日志
	 * @param event 事件名
	 * @param fields 结构化字段
	 */
	warn(event: string, fields?: LogFields): void
	/**
	 * error 级日志
	 * @param event 事件名
	 * @param fields 结构化字段
	 */
	error(event: string, fields?: LogFields): void
	/**
	 * 子 logger：绑定常驻字段（如 conversationId / agentId / subagentId），字段自动附加到所有后续记录
	 * @param bindings 常驻字段
	 * @returns 子 logger
	 */
	child(bindings: LogFields): Logger
	/** 强制落盘（flush 写缓冲） */
	flush(): Promise<void>
}
