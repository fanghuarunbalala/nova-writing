/**
 * LeaseClient：server 租约客户端（PRD 桌面接入 FR5）。
 * 会话粒度持有（PRD 非目标已拍板「每会话一租约，已够」）：acquire → 定时心跳（20s < 60s TTL）→ release。
 * 409 lease_held（他端持有，附 holderDeviceId）；410（失效/被回收）由使用方决定中止/恢复。
 */

export type LeaseFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** 他端持有（会话转只读 + 提示） */
export class LeaseHeldError extends Error {
	constructor(readonly holderDeviceId: string, readonly expiresAt: number) {
		super(`会话正被其他设备执行（至 ${new Date(expiresAt).toLocaleString()}）`);
		this.name = "LeaseHeldError";
	}
}

/** 租约失效/被回收（410：中止 run 走恢复流程） */
export class LeaseLostError extends Error {
	constructor(readonly code: string, message: string) {
		super(message);
		this.name = "LeaseLostError";
	}
}

export interface LeaseClientOptions {
	url: string;
	conversationId: string;
	getAccessToken: () => Promise<string | undefined>;
	fetchImpl?: LeaseFetch;
	/** 心跳间隔（缺省 20s；测试注入缩短） */
	heartbeatIntervalMs?: number;
	/** 心跳失败回调（410 → 使用方中止；网络错 → 容忍等待下次心跳） */
	onHeartbeatFailure?: (error: unknown) => void;
}

export class LeaseClient {
	private readonly opts: LeaseClientOptions;
	private readonly fetchImpl: LeaseFetch;
	private heartbeatTimer: NodeJS.Timeout | undefined;

	constructor(opts: LeaseClientOptions) {
		this.opts = opts;
		this.fetchImpl = opts.fetchImpl ?? ((i, j) => fetch(i, j));
	}

	/** 申请（同设备重复申请 = 续租，token 不变）；409 他端持有抛 LeaseHeldError */
	async acquire(): Promise<{ leaseToken: string; expiresAt: number }> {
		const body = await this.request("POST", "/v1/leases", { conversationId: this.opts.conversationId }, [200]);
		return { leaseToken: String(body.leaseToken), expiresAt: Number(body.expiresAt) };
	}

	/** 心跳一次（410 → LeaseLostError） */
	async heartbeat(leaseToken: string): Promise<void> {
		try {
			await this.request(
				"POST",
				`/v1/leases/${encodeURIComponent(this.opts.conversationId)}/heartbeat`,
				{ leaseToken },
				[200],
			);
		} catch (error) {
			this.opts.onHeartbeatFailure?.(error);
			if (error instanceof LeaseLostError) throw error;
			// 网络类失败：容忍（下次心跳重试；租约 60s TTL 内恢复不丢）
		}
	}

	/** 启动定时心跳 */
	startHeartbeat(leaseToken: string): void {
		this.stopHeartbeat();
		const interval = this.opts.heartbeatIntervalMs ?? 20_000;
		this.heartbeatTimer = setInterval(() => {
			void this.heartbeat(leaseToken).catch(() => {
				// LeaseLostError 已回调；其余静默重试
			});
		}, interval);
		this.heartbeatTimer.unref?.();
	}

	stopHeartbeat(): void {
		if (this.heartbeatTimer !== undefined) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
	}

	/** 释放（幂等；网络失败静默——TTL 到期自动回收） */
	async release(leaseToken: string): Promise<void> {
		this.stopHeartbeat();
		try {
			await this.request("DELETE", `/v1/leases/${encodeURIComponent(this.opts.conversationId)}`, { leaseToken }, [204]);
		} catch {
			// 网络/4xx 静默：孤儿租约由 TTL 回收
		}
	}

	private async request(
		method: string,
		path: string,
		body: unknown,
		expect: number[],
	): Promise<Record<string, unknown>> {
		const token = await this.opts.getAccessToken();
		if (token === undefined) throw new LeaseLostError("not_logged_in", "server 未登录");
		let response: Response;
		try {
			response = await this.fetchImpl(`${this.opts.url}${path}`, {
				method,
				headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
				...(method === "DELETE" ? { body: JSON.stringify(body) } : { body: JSON.stringify(body) }),
			});
		} catch (cause) {
			throw new Error(`租约请求网络失败：${String(cause)}`);
		}
		if (expect.includes(response.status)) {
			return response.status === 204 ? {} : ((await response.json()) as Record<string, unknown>);
		}
		const errorBody = (await response.json().catch(() => ({}))) as {
			code?: string;
			message?: string;
			holderDeviceId?: string;
			expiresAt?: number;
		};
		if (response.status === 409) {
			throw new LeaseHeldError(errorBody.holderDeviceId ?? "?", errorBody.expiresAt ?? 0);
		}
		if (response.status === 410 || response.status === 403) {
			throw new LeaseLostError(errorBody.code ?? `http_${response.status}`, errorBody.message ?? `租约失效 ${response.status}`);
		}
		throw new LeaseLostError(errorBody.code ?? `http_${response.status}`, errorBody.message ?? `租约请求失败 ${response.status}`);
	}
}
