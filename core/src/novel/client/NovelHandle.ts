/**
 * NovelHandle：conversation / UI 持有的 novel-db 客户端（wrap 侧）。
 * query/mutate 经 call 归一错误；events() 订阅 novel.changed。
 */

import { dispose, wrap } from "kkrpc";
import type { RPCMessage, Transport } from "kkrpc";
import { call } from "../../rpc/index.js";
import type { NovelQuery } from "../contract/query.js";
import type { NovelMutation } from "../contract/mutation.js";
import type { NovelChangeEvent } from "../contract/event.js";
import type { NovelMutateResult } from "../contract/snapshot.js";

/** novel-db 对外 API（与 NovelDbServer 的 expose 类型一致） */
export interface NovelApi {
	query(q: NovelQuery): Promise<unknown>;
	mutate(m: NovelMutation): Promise<NovelMutateResult>;
	events(): Promise<AsyncIterable<NovelChangeEvent>>;
}

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

	/**
	 * 订阅 novel.changed 事件流（kkrpc 流式返回 Promise<AsyncIterable>，await 后 for-await；break 即取消）
	 * @returns 解析后的事件异步迭代器
	 */
	async events(): Promise<AsyncIterable<NovelChangeEvent>> {
		return call(() => this.api.events(), { peer: "novel-db" });
	}

	/** 释放 handle（关闭通道） */
	dispose(): void {
		dispose(this.api);
	}
}
