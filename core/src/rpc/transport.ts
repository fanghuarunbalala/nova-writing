/**
 * 传输工厂：统一返回 kkrpc Transport<RPCMessage>，上层不感知底层。
 * stdio（manager↔conversation 父子派生）；memory（测试内存传输对）。
 * WS 工厂延到 novel-db 真实 WS 切片。
 */

import type { RPCMessage, Transport } from "kkrpc";
import {
	nodeStdioTransport,
	type ReadableLike,
	type WritableLike,
} from "kkrpc/stdio";

/** stdio 传输选项 */
export interface StdioTransportOptions {
	/** 可读流（父进程侧为子进程 stdout，子进程侧为 process.stdin） */
	readable: ReadableLike
	/** 可写流（父进程侧为子进程 stdin，子进程侧为 process.stdout） */
	writable: WritableLike
}

/**
 * 创建 stdio 传输（薄封装 nodeStdioTransport）。
 * 注意：stdout 必须是纯协议通道，日志走 stderr/文件。
 * @param opts stdio 流
 * @returns kkrpc Transport
 */
export function createStdioTransport(
	opts: StdioTransportOptions,
): Transport<RPCMessage> {
	return nodeStdioTransport({ readable: opts.readable, writable: opts.writable })
}

/** 内存传输对：A.send→B 订阅、B.send→A 订阅（测试用，不起进程不开端口） */
export type MemoryTransportPair = [Transport<RPCMessage>, Transport<RPCMessage>]

/**
 * 创建一对链式内存传输。
 * 用法：客户端 wrap 用 `pair[0]`，服务端 expose 用 `pair[1]`（或反之）。
 * @returns 两条全双工 Transport
 */
export function createMemoryTransportPair(): MemoryTransportPair {
	const aListeners = new Set<(msg: RPCMessage) => void>()
	const bListeners = new Set<(msg: RPCMessage) => void>()
	// 声明 remoteRefs（流式/回调）能力，让 kkrpc 把 async-iterable 方法当流
	const capabilities = { objectMode: true, remoteRefs: true }
	const a: Transport<RPCMessage> = {
		capabilities,
		send(msg) {
			for (const l of bListeners) l(msg)
		},
		subscribe(listener) {
			aListeners.add(listener)
			return () => {
				aListeners.delete(listener)
			}
		},
	}
	const b: Transport<RPCMessage> = {
		capabilities,
		send(msg) {
			for (const l of aListeners) l(msg)
		},
		subscribe(listener) {
			bListeners.add(listener)
			return () => {
				bListeners.delete(listener)
			}
		},
	}
	return [a, b]
}
