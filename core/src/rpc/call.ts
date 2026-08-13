/**
 * 远程调用归一化：把 thunk 抛出的错误归一成 RPCError。
 * 超时/AbortSignal 由域层经 kkrpc withCallOptions 施加，不在本层。
 */

import { RPCError } from "./RPCError.js";

/** call 上下文 */
export interface CallContext {
	/** 来源进程名 */
	peer?: string
}

/**
 * 执行远程调用并归一错误。
 * 已知错误映射：RPCTransportClosedError → peer-closed；AbortError → cancelled；其余 → remote。
 * @param fn 远程调用 thunk（已绑定 handle 的方法）
 * @param ctx 上下文（peer 用于诊断）
 * @returns thunk 的返回值
 * @throws RPCError 归一化后的错误
 */
export async function call<T>(fn: () => Promise<T>, ctx: CallContext = {}): Promise<T> {
	try {
		return await fn()
	} catch (err) {
		throw toRPCError(err, ctx.peer)
	}
}

/**
 * 把任意错误归一成 RPCError（已是 RPCError 原样返回）。
 * @param err 原始错误
 * @param peer 来源进程名
 * @returns RPCError
 */
export function toRPCError(err: unknown, peer?: string): RPCError {
	if (err instanceof RPCError) return err
	const record = err as { name?: string; errorCode?: string }
	if (record.name === "RPCTransportClosedError") {
		return new RPCError({ code: "peer-closed", peer, cause: err })
	}
	if (record.name === "AbortError") {
		return new RPCError({ code: "cancelled", peer, cause: err })
	}
	// 乐观锁冲突：Error.name 跨 RPC 序列化会丢，NovelStaleRevisionError 以自有
	// 可枚举 errorCode 字段标识（本地/远端实例都能判）
	if (record.errorCode === "novel-stale") {
		return new RPCError({ code: "stale", peer, cause: err })
	}
	// 远程方法抛错（kkrpc 保留 name/message/stack）与本地抛错都归 remote——
	// call 无法区分，统一按"远程调用失败"处理
	return new RPCError({ code: "remote", peer, cause: err })
}
