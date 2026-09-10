/**
 * ConfigServer：config 进程的 RPC server（expose 侧）。
 * expose { get, mutate, test }；存储经 ConfigStore 注入。
 */

import { expose, type ExposedController } from "kkrpc";
import type { RPCMessage, Transport } from "kkrpc";
import type { ConfigApi, McpServerInput, McpTestResult, ProviderRuntimeStatus } from "../contract.js";
import type {
	ServerAuthClient,
	ServerAuthSession,
	ServerAuthState,
	ServerDeviceInfo,
} from "../serverAuth.js";
import type { SkillsListResult } from "../../runtime/skill/listSkills.js";
import { testConnection } from "../connectionTest.js";
import type { ConfigStore } from "../store.js";

/** config RPC server */
export class ConfigServer {
	private readonly store: ConfigStore;
	private readonly runtimeStatus?: () => ProviderRuntimeStatus;
	private readonly skillsList?: () => Promise<SkillsListResult>;
	private readonly testMcp?: (input: McpServerInput) => Promise<McpTestResult>;
	private readonly serverAuth?: {
		session: ServerAuthSession;
		clientFactory: (url: string) => ServerAuthClient;
		deviceName: string;
		onLoginUrlPersist: (url: string) => Promise<void>;
	};
	private controller?: ExposedController;

	/**
	 * @param store 存储实现（内存 / node 持久化）
	 * @param deps.runtimeStatus provider 运行形态（宿主注入启动时快照；缺省不暴露 getRuntimeStatus）
	 * @param deps.skillsList 技能清单扫描（宿主注入目录解析；缺省不暴露 skillsList）
	 * @param deps.testMcp MCP 连接测试（宿主注入；缺省不暴露 testMcp）
	 * @param deps.serverAuth server 模式认证会话（宿主注入；缺省不暴露 server* 方法）
	 */
	constructor(
		store: ConfigStore,
		deps?: {
			runtimeStatus?: () => ProviderRuntimeStatus;
			skillsList?: () => Promise<SkillsListResult>;
			testMcp?: (input: McpServerInput) => Promise<McpTestResult>;
			serverAuth?: {
				session: ServerAuthSession;
				clientFactory: (url: string) => ServerAuthClient;
				deviceName: string;
				onLoginUrlPersist: (url: string) => Promise<void>;
			};
		},
	) {
		this.store = store;
		this.runtimeStatus = deps?.runtimeStatus;
		this.skillsList = deps?.skillsList;
		this.testMcp = deps?.testMcp;
		this.serverAuth = deps?.serverAuth;
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
			...(this.skillsList === undefined ? {} : { skillsList: () => this.skillsList!() }),
			...(this.testMcp === undefined ? {} : { testMcp: (input: McpServerInput) => this.testMcp!(input) }),
			...(this.serverAuth === undefined
				? {}
				: {
						serverAuth: (): Promise<ServerAuthState> => Promise.resolve(this.serverAuth!.session.state()),
						serverLogin: async (url: string, username: string, password: string): Promise<ServerAuthState> => {
							await this.serverAuth!.session.login(this.serverAuth!.clientFactory(url), username, password, this.serverAuth!.deviceName);
							// 登录成功 = server 模式激活：url 写入配置 + 会话指向新 url（restore 复读刚落的令牌）
							await this.serverAuth!.onLoginUrlPersist(url);
							await this.serverAuth!.session.restore(url);
							return this.serverAuth!.session.state();
						},
						serverRegister: async (url: string, username: string, password: string): Promise<ServerAuthState> => {
							// 注册即登录（server 201 带双令牌）；落地路径与 serverLogin 对称
							await this.serverAuth!.session.register(this.serverAuth!.clientFactory(url), username, password, this.serverAuth!.deviceName);
							await this.serverAuth!.onLoginUrlPersist(url);
							await this.serverAuth!.session.restore(url);
							return this.serverAuth!.session.state();
						},
						serverLogout: async (): Promise<ServerAuthState> => {
							await this.serverAuth!.session.logout();
							return this.serverAuth!.session.state();
						},
						serverDevices: async (): Promise<ServerDeviceInfo[]> => {
							const devices = await this.serverAuth!.session.devices();
							if (devices === undefined) throw new Error("未登录或 server 未配置");
							return devices;
						},
						serverKickDevice: (deviceId: string) => this.serverAuth!.session.kickDevice(deviceId),
						onServerAuthChange: (listener: (state: ServerAuthState) => void) =>
							Promise.resolve(this.serverAuth!.session.onStatusChange(listener)),
					}),
		};
		this.controller = expose(api, transport);
	}

	/** 关闭：dispose expose */
	async close(): Promise<void> {
		this.controller?.dispose?.();
		this.controller = undefined;
	}
}
