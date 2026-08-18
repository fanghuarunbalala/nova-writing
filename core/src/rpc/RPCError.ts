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
	/** 书库业务码（LibraryError.code 跨 RPC 映射；renderer 按 code 分支提示） */
	| "lib-book-not-found"
	| "lib-book-not-authorized"
	| "lib-invalid-argument"
	| "lib-import-failed"

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

/** API 传输错误：renderer 端口 unwrap（{ ok:false } 响应）时抛出（如 design 文件端口） */
export class ApiTransportError extends RPCError {
	/** 业务错误码（如 design_file_not_found / unauthorized） */
	readonly codeName: string
	/** 是否可重试 */
	readonly retryable: boolean

	/**
	 * @param codeName 业务错误码
	 * @param retryable 是否可重试
	 * @param message 错误消息（缺省按 codeName 生成）
	 */
	constructor(codeName: string, retryable: boolean, message?: string) {
		super({ code: "remote" }, message ?? `api.transport.${codeName}`)
		this.name = "ApiTransportError"
		this.codeName = codeName
		this.retryable = retryable
	}
}
