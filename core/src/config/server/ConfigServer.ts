/**
 * ConfigServer：config 进程的 RPC server（expose 侧）。
 * expose { get, mutate, test }；存储经 ConfigStore 注入。
 */

import { expose, type ExposedController } from "kkrpc";
import type { RPCMessage, Transport } from "kkrpc";
import type { ConfigApi, ProviderRuntimeStatus } from "../contract.js";
import { testConnection } from "../connectionTest.js";
import type { ConfigStore } from "../store.js";

/** config RPC server */
export class ConfigServer {
	private readonly store: ConfigStore;
	private readonly runtimeStatus?: () => ProviderRuntimeStatus;
	private controller?: ExposedController;

	/**
	 * @param store 存储实现（内存 / node 持久化）
	 * @param deps.runtimeStatus provider 运行形态（宿主注入启动时快照；缺省不暴露 getRuntimeStatus）
	 */
	constructor(store: ConfigStore, deps?: { runtimeStatus?: () => ProviderRuntimeStatus }) {
		this.store = store;
		this.runtimeStatus = deps?.runtimeStatus;
	}

	/**
	 * 启动：expose API 到传输
	 * @param transport 传输（Electron IPC / 测试内存）
	 */
	async start(transport: Transport<RPCMessage>): Promise<void> {
		const api: ConfigApi = {
			get: () => this.store.get(),
			mutate: (m) => this.store.mutate(m),
			test: (input) => testConnection(this.store, input),
			...(this.runtimeStatus === undefined
				? {}
				: { getRuntimeStatus: () => Promise.resolve(this.runtimeStatus!()) }),
		};
		this.controller = expose(api, transport);
	}

	/** 关闭：dispose expose */
	async close(): Promise<void> {
		this.controller?.dispose?.();
		this.controller = undefined;
	}
}
