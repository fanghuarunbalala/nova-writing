/**
 * ConfigStore：config 存储抽象（RPC server 与持久化之间）。
 */

import type { ConfigMutation, ConfigSnapshot, CredentialRef } from "./contract.js";

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
	/**
	 * 解析凭据明文（经 cipher 解密）。仅供宿主进程（Electron main / 守护）本地使用，
	 * 严禁经 RPC 暴露（ConfigApi 不含此方法）。
	 * @param ref 凭据引用
	 * @returns 明文密钥（缺失时 undefined）
	 */
	resolveSecret(ref: CredentialRef): Promise<string | undefined>
}
