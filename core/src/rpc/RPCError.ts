/**
 * 远程调用错误模型：业务只按 code 分支。
 */

/** RPC 错误码 */
export type RPCErrorCode =
	| "timeout"
	| "peer-closed"
	| "remote"
	| "stale"
	| "invalid-request"
	| "cancelled"
	| "unknown"

/** RPCError 构造选项 */
export interface RPCErrorOptions {
	/** 错误码 */
	code: RPCErrorCode
	/** 来源进程名（诊断用） */
	peer?: string
	/** 原始错误 */
	cause?: unknown
}

/** 远程调用错误 */
export class RPCError extends Error {
	/** 错误码 */
	readonly code: RPCErrorCode
	/** 来源进程名 */
	readonly peer?: string
	/** 原始错误（override Error.cause） */
	override readonly cause?: unknown

	/**
	 * @param opts 错误选项
	 * @param message 错误消息（缺省按 code 生成）
	 */
	constructor(opts: RPCErrorOptions, message?: string) {
		super(message ?? `rpc.${opts.code}${opts.peer ? ` (peer=${opts.peer})` : ""}`)
		this.name = "RPCError"
		this.code = opts.code
		this.peer = opts.peer
		this.cause = opts.cause
	}
}
