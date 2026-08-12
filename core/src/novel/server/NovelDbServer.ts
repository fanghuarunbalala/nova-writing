/**
 * NovelDbServer：novel-db 进程的 RPC server（expose 侧）。
 * expose { query, mutate, subscribe, unsubscribe }；mutate 成功广播 novel.changed。
 * 存储经 NovelStore 注入，与 sqlite 解耦。
 * 订阅用 kkrpc callback（stdio/序列化传输下可靠，async-iterable 流式在 kkrpc stdio 上有重建问题）。
 */

import { expose, type ExposedController } from "kkrpc";
import type { RPCMessage, Transport } from "kkrpc";
import type { NovelStore } from "../store.js";
import type { NovelQuery } from "../contract/query.js";
import type { NovelMutation } from "../contract/mutation.js";
import type { NovelChangeEvent } from "../contract/event.js";
import type { NovelMutateResult } from "../contract/snapshot.js";

/** novel-db 对外 API（与 NovelHandle 的 wrap 类型一致） */
export interface NovelApi {
	/**
	 * 查询
	 * @param q 查询
	 * @returns 对应 snapshot
	 */
	query(q: NovelQuery): Promise<unknown>;
	/**
	 * 变更（成功广播 novel.changed）
	 * @param m 变更
	 * @returns 变更结果
	 */
	mutate(m: NovelMutation): Promise<NovelMutateResult>;
	/**
	 * 订阅 novel.changed（callback）
	 * @param onEvent 变更回调
	 * @returns 订阅 id（用于 unsubscribe）
	 */
	subscribe(onEvent: (evt: NovelChangeEvent) => void): Promise<string>;
	/**
	 * 取消订阅
	 * @param id 订阅 id
	 */
	unsubscribe(id: string): Promise<void>;
}

/** novel-db RPC server */
export class NovelDbServer {
	private readonly store: NovelStore;
	private controller?: ExposedController;
	private readonly changeListeners = new Map<string, (evt: NovelChangeEvent) => void>();
	private nextSubId = 0;

	/**
	 * @param store 存储实现（内存先行，sqlite 下阶段）
	 */
	constructor(store: NovelStore) {
		this.store = store;
	}

	/**
	 * 启动：expose API 到传输
	 * @param transport 传输（WS：conversation/UI 连接；测试用内存/stdio）
	 */
	async start(transport: Transport<RPCMessage>): Promise<void> {
		const api: NovelApi = {
			query: (q) => this.query(q),
			mutate: (m) => this.applyMutation(m),
			subscribe: (onEvent) => this.subscribe(onEvent),
			unsubscribe: (id) => this.unsubscribe(id),
		};
		this.controller = expose(api, transport);
	}

	/**
	 * 查询（经 store）
	 * @param q 查询
	 * @returns 对应 snapshot
	 */
	async query(q: NovelQuery): Promise<unknown> {
		return this.store.query(q);
	}

	/**
	 * 应用变更并广播 novel.changed
	 * @param m 变更
	 * @returns 变更结果
	 */
	async applyMutation(m: NovelMutation): Promise<NovelMutateResult> {
		const result = await this.store.mutate(m);
		this.broadcast({
			type: "novel.changed",
			op: m.op,
			entity: result.entity,
			id: result.changeId,
			version: result.version,
			ts: new Date().toISOString(),
		});
		return result;
	}

	/**
	 * 订阅 novel.changed
	 * @param onEvent 变更回调
	 * @returns 订阅 id
	 */
	async subscribe(onEvent: (evt: NovelChangeEvent) => void): Promise<string> {
		const id = `sub-${++this.nextSubId}`;
		this.changeListeners.set(id, onEvent);
		return id;
	}

	/**
	 * 取消订阅
	 * @param id 订阅 id
	 */
	async unsubscribe(id: string): Promise<void> {
		this.changeListeners.delete(id);
	}

	/** 关闭：停订阅 + dispose expose */
	async close(): Promise<void> {
		this.changeListeners.clear();
		this.controller?.dispose?.();
		this.controller = undefined;
	}

	/** 广播变更事件给所有订阅者 */
	private broadcast(evt: NovelChangeEvent): void {
		for (const listener of this.changeListeners.values()) listener(evt);
	}
}
