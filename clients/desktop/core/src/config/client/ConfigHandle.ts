/**
 * ConfigHandle：UI / zygote 持有的 config 客户端（wrap 侧）。
 * get/mutate/test 经 call 归一错误。
 */

import { dispose, wrap } from "kkrpc";
import type { RPCMessage, Transport } from "kkrpc";
import { call } from "../../rpc/call.js";
import type {
	ConfigApi,
	ConfigMutation,
	ConfigSnapshot,
	ConnectionTestInput,
	ConnectionTestResult,
	ProviderRuntimeStatus,
} from "../contract.js";

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

	/**
	 * 测试模型服务连通性（轻量 GET /models：验证 baseUrl 可达 + 密钥有效）
	 * @param input 测试输入（apiKey 直传或 credentialRef 引用已存凭据）
	 * @returns 测试结果（失败附中文原因）
	 */
	async test(input: ConnectionTestInput): Promise<ConnectionTestResult> {
		return call(() => this.api.test(input), { peer: "config" });
	}

	/**
	 * 读取 provider 运行形态（宿主注入的启动时快照）。
	 * server 未注入 / 查询失败回退 providerLive=true（视为已连接，维持现状文案）。
	 * @returns provider 运行形态
	 */
	async getRuntimeStatus(): Promise<ProviderRuntimeStatus> {
		try {
			return await call(() => this.api.getRuntimeStatus?.() ?? Promise.resolve({ providerLive: true }), {
				peer: "config",
			});
		} catch {
			return { providerLive: true };
		}
	}

	/** 释放 handle（断开通道） */
	dispose(): void {
		dispose(this.api);
	}
}
