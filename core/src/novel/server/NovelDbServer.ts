/**
 * NovelDbServer：novel-db 进程的 RPC server（expose 侧）。
 * expose { query, mutate }；mutate 成功经 EventPublisher（ZeroMQ PUB）广播 novel.changed。
 * 存储经 NovelStore 注入；事件发布经 EventPublisher 注入（进程启动时 bind，测试用 inproc）。
 */

import { expose, type ExposedController } from "kkrpc";
import type { RPCMessage, Transport } from "kkrpc";
import { EventPublisher, NOVEL_CHANGED } from "../../event/index.js";
import type { NovelStore } from "../store.js";
import type { NovelApi } from "../contract/api.js";
import type { NovelQuery } from "../contract/query.js";
import type { NovelMutation } from "../contract/mutation.js";
import type { NovelChangeEvent } from "../contract/event.js";
import type { NovelMutateResult } from "../contract/snapshot.js";

/** novel-db RPC server */
export class NovelDbServer {
	private readonly store: NovelStore;
	private readonly publisher: EventPublisher;
	private controller?: ExposedController;

	/**
	 * @param store 存储实现（内存先行，sqlite 下阶段）
	 * @param publisher 事件发布器（进程启动时 bind 到 NOVEL_EVENTS_ADDR）
	 */
	constructor(store: NovelStore, publisher: EventPublisher) {
		this.store = store;
		this.publisher = publisher;
	}

	/**
	 * 启动：expose API 到传输
	 * @param transport 传输（WS：conversation/UI 连接；测试用内存/stdio）
	 */
	async start(transport: Transport<RPCMessage>): Promise<void> {
		const api: NovelApi = {
			query: (q) => this.query(q),
			mutate: (m) => this.applyMutation(m),
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
	 * 应用变更并广播 novel.changed（ZeroMQ PUB）
	 * @param m 变更
	 * @returns 变更结果
	 */
	async applyMutation(m: NovelMutation): Promise<NovelMutateResult> {
		const result = await this.store.mutate(m);
		const evt: NovelChangeEvent = {
			type: "novel.changed",
			op: m.op,
			entity: result.entity,
			id: result.changeId,
			version: result.version,
			ts: new Date().toISOString(),
		};
		this.publisher.publish(NOVEL_CHANGED, evt);
		return result;
	}

	/** 关闭：dispose expose */
	async close(): Promise<void> {
		this.controller?.dispose?.();
		this.controller = undefined;
	}
}
