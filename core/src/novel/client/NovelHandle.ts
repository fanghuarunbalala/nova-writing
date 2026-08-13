/**
 * NovelHandle：conversation / UI 持有的 novel-db 客户端（wrap 侧）。
 * query/mutate 经 call 归一错误；novel.changed 不走 RPC——消费者用 EventSubscriber（ZeroMQ）订阅。
 */

import { dispose, wrap } from "kkrpc";
import type { RPCMessage, Transport } from "kkrpc";
import { call } from "../../rpc/call.js";
import type { NovelApi } from "../contract/api.js";
import type { NovelQuery } from "../contract/query.js";
import type { NovelMutation } from "../contract/mutation.js";
import type { NovelMutateResult } from "../contract/snapshot.js";

/** novel-db 客户端 handle */
export class NovelHandle {
	private readonly api: NovelApi;

	/**
	 * @param transport 传输（conversation/UI 到 novel-db 的连接）
	 */
	constructor(transport: Transport<RPCMessage>) {
		this.api = wrap<NovelApi>(transport);
	}

	/**
	 * 查询
	 * @param q 查询
	 * @returns 对应 snapshot
	 */
	async query<T = unknown>(q: NovelQuery): Promise<T> {
		return call(() => this.api.query(q), { peer: "novel-db" }) as Promise<T>;
	}

	/**
	 * 变更
	 * @param m 变更
	 * @returns 变更结果
	 */
	async mutate(m: NovelMutation): Promise<NovelMutateResult> {
		return call(() => this.api.mutate(m), { peer: "novel-db" });
	}

	/** 释放 handle（关闭通道） */
	dispose(): void {
		dispose(this.api);
	}
}
