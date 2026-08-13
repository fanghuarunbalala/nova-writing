/**
 * ConfigHandle：UI / zygote 持有的 config 客户端（wrap 侧）。
 * get/mutate 经 call 归一错误。
 */

import { dispose, wrap } from "kkrpc";
import type { RPCMessage, Transport } from "kkrpc";
import { call } from "../../rpc/call.js";
import type { ConfigApi, ConfigMutation, ConfigSnapshot } from "../contract.js";

/** config 客户端 handle */
export class ConfigHandle {
	private readonly api: ConfigApi;

	/**
	 * @param transport 传输（UI / zygote 到 config server 的连接）
	 */
	constructor(transport: Transport<RPCMessage>) {
		this.api = wrap<ConfigApi>(transport);
	}

	/**
	 * 读取配置快照
	 * @returns 配置快照
	 */
	async get(): Promise<ConfigSnapshot> {
		return call(() => this.api.get(), { peer: "config" });
	}

	/**
	 * 变更配置
	 * @param m 变更
	 */
	async mutate(m: ConfigMutation): Promise<void> {
		return call(() => this.api.mutate(m), { peer: "config" });
	}

	/** 释放 handle（断开通道） */
	dispose(): void {
		dispose(this.api);
	}
}
