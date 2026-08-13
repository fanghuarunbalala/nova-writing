/**
 * ConfigServer：config 进程的 RPC server（expose 侧）。
 * expose { get, mutate }；存储经 ConfigStore 注入。
 */

import { expose, type ExposedController } from "kkrpc";
import type { RPCMessage, Transport } from "kkrpc";
import type { ConfigApi } from "../contract.js";
import type { ConfigStore } from "../store.js";

/** config RPC server */
export class ConfigServer {
	private readonly store: ConfigStore;
	private controller?: ExposedController;

	/**
	 * @param store 存储实现（内存 / node 持久化）
	 */
	constructor(store: ConfigStore) {
		this.store = store;
	}

	/**
	 * 启动：expose API 到传输
	 * @param transport 传输（Electron IPC / 测试内存）
	 */
	async start(transport: Transport<RPCMessage>): Promise<void> {
		const api: ConfigApi = {
			get: () => this.store.get(),
			mutate: (m) => this.store.mutate(m),
		};
		this.controller = expose(api, transport);
	}

	/** 关闭：dispose expose */
	async close(): Promise<void> {
		this.controller?.dispose?.();
		this.controller = undefined;
	}
}
