/**
 * NovelDbServer：novel-db 进程的 RPC server（expose 侧）。
 * expose { query, mutate, events }；mutate 成功广播 novel.changed。
 * 存储经 NovelStore 注入，与 sqlite 解耦。
 * applyMutation / subscribeEvents 为 public，便于脱离 RPC 单测广播与订阅逻辑。
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
	/** 订阅 novel.changed 事件流 */
	events(): AsyncIterable<NovelChangeEvent>;
}

/** novel-db RPC server */
export class NovelDbServer {
	private readonly store: NovelStore;
	private controller?: ExposedController;
	private readonly changeListeners = new Set<(evt: NovelChangeEvent) => void>();

	/**
	 * @param store 存储实现（内存先行，sqlite 下阶段）
	 */
	constructor(store: NovelStore) {
		this.store = store;
	}

	/**
	 * 启动：expose API 到传输
	 * @param transport 传输（WS：conversation/UI 连接；测试用内存）
	 */
	async start(transport: Transport<RPCMessage>): Promise<void> {
		const api: NovelApi = {
			query: (q) => this.query(q),
			mutate: (m) => this.applyMutation(m),
			events: () => this.subscribeEvents(),
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

	/** 关闭：停订阅 + dispose expose */
	async close(): Promise<void> {
		this.changeListeners.clear();
		this.controller?.dispose?.();
		this.controller = undefined;
	}

	/** 广播变更事件给所有订阅者 */
	private broadcast(evt: NovelChangeEvent): void {
		for (const listener of this.changeListeners) listener(evt);
	}

	/**
	 * 订阅事件流：每个订阅一个独立 async iterable（队列 + waiter，无丢事件）
	 * @returns 事件异步迭代器（return/break 即取消订阅）
	 */
	subscribeEvents(): AsyncIterable<NovelChangeEvent> {
		const queue: NovelChangeEvent[] = [];
		const waiters: Array<(evt: NovelChangeEvent) => void> = [];
		const listener = (evt: NovelChangeEvent) => {
			const waiter = waiters.shift();
			if (waiter) waiter(evt);
			else queue.push(evt);
		};
		this.changeListeners.add(listener);
		return {
			[Symbol.asyncIterator]: () => ({
				next: async () => {
					if (queue.length) return { done: false, value: queue.shift()! };
					const evt = await new Promise<NovelChangeEvent>((res) =>
						waiters.push(res),
					);
					return { done: false, value: evt };
				},
				return: async () => {
					this.changeListeners.delete(listener);
					return { done: true, value: undefined };
				},
			}),
		};
	}
}
