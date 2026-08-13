/**
 * ConfigStore：config 存储抽象（RPC server 与持久化之间）。
 */

import type { ConfigMutation, ConfigSnapshot } from "./contract.js";

/** config 存储（get 读 / mutate 写） */
export interface ConfigStore {
	/**
	 * 读取配置快照
	 * @returns 配置快照
	 */
	get(): Promise<ConfigSnapshot>
	/**
	 * 变更配置
	 * @param m 变更
	 */
	mutate(m: ConfigMutation): Promise<void>
}
