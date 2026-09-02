/**
 * server 模式认证（docs/PRD/桌面接入-数据通道server化.md FR1）：
 * - ServerAuthClient：REST 封装（登录/刷新/登出/设备列表/踢出），fetch 可注入便于测试；
 * - ServerTokenStore：双令牌落盘（经 CredentialCipher 加密，不进 config.json）；
 * - ServerAuthSession：会话状态机（在线/离线/未配置）+ access 过期前主动轮换 +
 *   复用检测（refresh 被拒）→ 清令牌并广播「需重登」。
 * BYOK 边界：本模块只管理 server 侧双令牌，模型 API key 不经过这里。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CredentialCipher } from "./CredentialCipher.js";

/** 连接状态（设置页指示） */
export type ServerConnectionStatus = "unconfigured" | "online" | "offline";

/** 双令牌（落盘前经 cipher 加密） */
export interface ServerAuthTokens {
	accessToken: string
	/** access 过期时刻（epoch ms；由登录/刷新响应的 expiresIn 换算） */
	accessExpiresAt: number
	refreshToken: string
	/** 登录用户名（UI 回显；server 不回传，登录时本地记录） */
	username: string
}

/** 设备会话条目（server /v1/auth/devices 返回） */
export interface ServerDeviceInfo {
	id: string
	name: string
	created_at: number
	last_seen_at: number
	active_sessions: number
}

/** server 认证错误（附 server 错误码，便于 UI 区分「凭据错误」与「复用检测需重登」） */
export class ServerAuthError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "ServerAuthError";
	}
}

/** 可注入的 fetch 形态（测试用） */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** REST 客户端：无状态，令牌由调用方（ServerAuthSession）管理 */
export class ServerAuthClient {
	private readonly baseUrl: string;
	private readonly fetchImpl: FetchLike;
	private readonly now: () => number;

	constructor(baseUrl: string, fetchImpl: FetchLike = (i, j) => fetch(i, j), now: () => number = () => Date.now()) {
		this.baseUrl = baseUrl.replace(/\/+$/, "");
		this.fetchImpl = fetchImpl;
		this.now = now;
	}

	/** 登录（注册流程引导用户去 server 侧完成，桌面只登录） */
	async login(username: string, password: string, deviceName: string): Promise<ServerAuthTokens & { deviceId: string }> {
		const body = await this.postJson("/v1/auth/login", { username, password, deviceName }, 200);
		return {
			accessToken: this.str(body, "accessToken"),
			accessExpiresAt: this.now() + ACCESS_TTL_MS,
			refreshToken: this.str(body, "refreshToken"),
			username,
			deviceId: this.str(body, "deviceId"),
		};
	}

	/** 刷新（一次一换；401 = 复用检测/过期/吊销，调用方应清令牌） */
	async refresh(refreshToken: string): Promise<ServerAuthTokens> {
		const body = await this.postJson("/v1/auth/refresh", { refreshToken }, 200);
		return {
			accessToken: this.str(body, "accessToken"),
			accessExpiresAt: this.now() + ACCESS_TTL_MS,
			refreshToken: this.str(body, "refreshToken"),
			username: "",
		};
	}

	/** 登出（吊销当前 refresh；server 204，失败静默——令牌本地必清） */
	async logout(refreshToken: string): Promise<void> {
		try {
			await this.postJson("/v1/auth/logout", { refreshToken }, 204);
		} catch {
			// 网络失败也继续本地清令牌
		}
	}

	async devices(accessToken: string): Promise<ServerDeviceInfo[]> {
		const body = await this.requestJson("/v1/auth/devices", { method: "GET", token: accessToken }, 200);
		const devices = (body as { devices?: unknown }).devices;
		if (!Array.isArray(devices)) throw new ServerAuthError("bad_response", "设备列表响应格式异常");
		return devices as ServerDeviceInfo[];
	}

	async kickDevice(accessToken: string, deviceId: string): Promise<void> {
		await this.requestJson(`/v1/auth/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE", token: accessToken }, 204);
	}

	/** 响应必填字符串字段提取（缺失/非字符串 = server 契约异常） */
	private str(body: Record<string, unknown>, key: string): string {
		const value = body[key];
		if (typeof value !== "string" || value.length === 0) {
			throw new ServerAuthError("bad_response", `响应缺少字段 ${key}`);
		}
		return value;
	}

	private postJson(path: string, payload: unknown, expectStatus: number): Promise<Record<string, unknown>> {
		return this.requestJson(path, { method: "POST", token: undefined, body: payload }, expectStatus);
	}

	private async requestJson(
		path: string,
		init: { method: string; token?: string; body?: unknown },
		expectStatus: number,
	): Promise<Record<string, unknown>> {
		let response: Response;
		try {
			response = await this.fetchImpl(`${this.baseUrl}${path}`, {
				method: init.method,
				headers: {
					...(init.body !== undefined ? { "content-type": "application/json" } : {}),
					...(init.token !== undefined ? { authorization: `Bearer ${init.token}` } : {}),
				},
				...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
			});
		} catch (cause) {
			throw new ServerAuthError("network_unreachable", `无法连接服务器：${String(cause)}`);
		}
		if (response.status === expectStatus) return response.status === 204 ? ({} as Record<string, unknown>) : ((await response.json()) as Record<string, unknown>);
		let code = `http_${response.status}`;
		let message = `服务器返回 ${response.status}`;
		try {
			const body = (await response.json()) as { code?: string; message?: string };
			if (body.code) code = body.code;
			if (body.message) message = body.message;
		} catch {
			// 非 JSON 错误体：保留 HTTP 状态码语义
		}
		throw new ServerAuthError(code, message, response.status);
	}
}

/** server JWT access 有效期（与 server/src/jwt.ts 对齐：15min） */
const ACCESS_TTL_MS = 15 * 60 * 1000;
/** access 过期前多久主动轮换 */
const REFRESH_AHEAD_MS = 60 * 1000;

/** 令牌落盘结构（cipher 加密整个 JSON） */
interface TokenFilePayload {
	tokens: ServerAuthTokens
	deviceId: string
}

/** 双令牌文件存储（journal 无关、独立于 config.json——凭据永不混入普通配置） */
export class ServerTokenStore {
	private readonly filePath: string;
	private readonly cipher: CredentialCipher;

	constructor(filePath: string, cipher: CredentialCipher) {
		this.filePath = filePath;
		this.cipher = cipher;
	}

	async load(): Promise<TokenFilePayload | undefined> {
		try {
			const encrypted = await readFile(this.filePath, "utf8");
			return JSON.parse(await this.cipher.decrypt(encrypted)) as TokenFilePayload;
		} catch {
			return undefined;
		}
	}

	async save(payload: TokenFilePayload): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		const encrypted = await this.cipher.encrypt(JSON.stringify(payload));
		await writeFile(this.filePath, encrypted, "utf8");
	}

	async clear(): Promise<void> {
		await writeFile(this.filePath, "", "utf8");
	}
}

/** 会话状态快照（UI 展示） */
export interface ServerAuthState {
	status: ServerConnectionStatus
	url?: string
	username?: string
	deviceId?: string
	/** 复用检测触发（token_reuse_detected/revoked/expired）→ UI 提示重新登录 */
	needRelogin?: boolean
}

/**
 * 认证会话：持有令牌、主动轮换、状态广播。
 * 未配置 server（无 url）时 status 恒为 unconfigured，所有方法直通不触网——本地模式零侵入。
 */
export class ServerAuthSession {
	private tokens?: ServerAuthTokens;
	private deviceId?: string;
	private url?: string;
	private offline = false;
	private needRelogin = false;
	private refreshing: Promise<boolean> | undefined;
	private readonly listeners = new Set<(state: ServerAuthState) => void>();

	constructor(
		private readonly tokenStore: ServerTokenStore,
		private readonly clientFactory: (url: string) => ServerAuthClient,
		private readonly now: () => number = () => Date.now(),
	) {}

	/** 启动时恢复：配置的 url + 落盘令牌 */
	async restore(url: string | undefined): Promise<ServerAuthState> {
		this.url = url;
		const persisted = url ? await this.tokenStore.load() : undefined;
		this.tokens = persisted?.tokens;
		this.deviceId = persisted?.deviceId;
		this.needRelogin = false;
		this.offline = false;
		return this.state();
	}

	state(): ServerAuthState {
		if (this.url === undefined) return { status: "unconfigured" };
		if (!this.tokens) return { status: this.offline ? "offline" : "online", url: this.url, needRelogin: this.needRelogin };
		return {
			status: this.offline ? "offline" : "online",
			url: this.url,
			username: this.tokens.username || undefined,
			deviceId: this.deviceId,
			needRelogin: this.needRelogin,
		};
	}

	onStatusChange(listener: (state: ServerAuthState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(): void {
		const snapshot = this.state();
		for (const listener of this.listeners) listener(snapshot);
	}

	/** 登录成功 → 存令牌 + 状态转在线 */
	async login(client: ServerAuthClient, username: string, password: string, deviceName: string): Promise<void> {
		const result = await client.login(username, password, deviceName);
		this.tokens = { ...result, username };
		this.deviceId = result.deviceId;
		this.offline = false;
		this.needRelogin = false;
		await this.tokenStore.save({ tokens: this.tokens, deviceId: result.deviceId });
		this.emit();
	}

	/**
	 * 取有效 access：过期前 1min 内（或已过期）先轮换。
	 * @returns access；未登录/配置缺失返回 undefined；网络失败标记 offline 并返回 undefined
	 */
	async ensureAccessToken(): Promise<string | undefined> {
		if (this.url === undefined || !this.tokens) return undefined;
		if (this.tokens.accessExpiresAt - REFRESH_AHEAD_MS > this.now() && !this.needRelogin) {
			return this.tokens.accessToken;
		}
		if (this.needRelogin) return undefined;
		// 并发调用共用一次轮换
		this.refreshing ??= this.rotate().finally(() => (this.refreshing = undefined));
		return this.refreshing ? (await this.refreshing ? this.tokens?.accessToken : undefined) : undefined;
	}

	private async rotate(): Promise<boolean> {
		if (!this.tokens) return false;
		try {
			const next = await this.clientFactory(this.url!).refresh(this.tokens.refreshToken);
			this.tokens = { ...next, username: this.tokens.username };
			this.offline = false;
			await this.tokenStore.save({ tokens: this.tokens, deviceId: this.deviceId! });
			this.emit();
			return true;
		} catch (error) {
			if (error instanceof ServerAuthError && error.status === 401) {
				// 复用检测/过期/吊销：清令牌，要求重登（网络类错误只标 offline）
				this.tokens = undefined;
				this.needRelogin = true;
				await this.tokenStore.clear();
			} else {
				this.offline = true;
			}
			this.emit();
			return false;
		}
	}

	/** 登出：吊销 refresh + 清本地令牌 */
	async logout(): Promise<void> {
		if (this.tokens) await this.clientFactory(this.url!).logout(this.tokens.refreshToken);
		this.tokens = undefined;
		this.needRelogin = false;
		await this.tokenStore.clear();
		this.emit();
	}

	/** 请求失败上报（数据通道 401/网络错误 → 状态降级；UI 与后续阶段复用） */
	reportRequestFailure(error: unknown): void {
		if (error instanceof ServerAuthError) {
			if (error.status === 401) {
				this.needRelogin = this.tokens === undefined;
				this.emit();
			} else if (error.code === "network_unreachable") {
				this.offline = true;
				this.emit();
			}
		}
	}

	/** 请求成功上报（离线恢复） */
	reportRequestSuccess(): void {
		if (this.offline) {
			this.offline = false;
			this.emit();
		}
	}

	/** 设备列表（需已登录） */
	async devices(): Promise<ServerDeviceInfo[] | undefined> {
		const token = await this.ensureAccessToken();
		if (token === undefined) return undefined;
		return this.clientFactory(this.url!).devices(token);
	}

	/** 踢设备（server 侧吊销其全部会话；若是本设备则进入 needRelogin） */
	async kickDevice(deviceId: string): Promise<void> {
		const token = await this.ensureAccessToken();
		if (token === undefined) throw new ServerAuthError("not_logged_in", "未登录");
		await this.clientFactory(this.url!).kickDevice(token, deviceId);
		if (deviceId === this.deviceId) {
			this.tokens = undefined;
			this.needRelogin = true;
			await this.tokenStore.clear();
			this.emit();
		}
	}
}
