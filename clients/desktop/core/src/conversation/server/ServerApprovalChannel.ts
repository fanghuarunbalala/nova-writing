/**
 * ServerApprovalChannel：审批两段式的 server 通道（PRD 桌面接入 FR4）。
 * - submit：本地征询产生时 POST /v1/approvals（持久化 + SSE 广播给其它端）；
 * - resolve：本地批掉时 POST /v1/approvals/:rid/resolve（幂等 409 already_decided 容忍）；
 * - list：审批中心（GET /v1/approvals，任意端挂起的征询桌面可批）；
 * - SSE approval_resolved 事件由使用方（gui main）回填本地队列——本地队列仍是 UI 权威，
 *   server 是持久层与跨端通道；两端先到者生效，resolve 幂等。
 */

export type ApprovalFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ServerApprovalCall {
	name: string;
	arguments?: unknown;
}

/** server 审批行（GET 返回） */
export interface ServerApprovalRow {
	id: number;
	request_id: string;
	conversation_id: string;
	run_seq: number;
	calls_json: string;
	status: "pending" | "approve" | "reject" | "expired";
	comment: string | null;
	decided_by: string | null;
	created_at: number;
	decided_at: number | null;
}

export interface ServerApprovalChannelOptions {
	url: string;
	getAccessToken: () => Promise<string | undefined>;
	/** 征询属 run 执行权校验（server 检查会话租约） */
	getLeaseToken: (conversationId: string) => string | undefined;
	fetchImpl?: ApprovalFetch;
}

export class ServerApprovalChannel {
	private readonly opts: ServerApprovalChannelOptions;
	private readonly fetchImpl: ApprovalFetch;

	constructor(opts: ServerApprovalChannelOptions) {
		this.opts = opts;
		this.fetchImpl = opts.fetchImpl ?? ((i, j) => fetch(i, j));
	}

	/** 征询上 server（持久化 + 其它端 SSE 可见）。失败静默（server 不可达不阻塞本地审批流） */
	async submit(input: {
		conversationId: string;
		requestId: string;
		runSeq: number;
		calls: ServerApprovalCall[];
	}): Promise<void> {
		try {
			await this.request("POST", "/v1/approvals", {
				conversationId: input.conversationId,
				requestId: input.requestId,
				runSeq: input.runSeq,
				calls: input.calls,
				leaseToken: this.opts.getLeaseToken(input.conversationId),
			}, [201]);
		} catch {
			// 本地队列照常工作；跨端可见性降级
		}
	}

	/** 本地决议同步到 server（其它端 SSE 收敛；幂等 409 容忍）。失败静默（server 懒过期兜底） */
	async resolve(requestId: string, decision: "approve" | "reject", comment?: string): Promise<void> {
		try {
			await this.request("POST", `/v1/approvals/${encodeURIComponent(requestId)}/resolve`, { decision, comment }, [200, 409]);
		} catch {
			// 已决/离线：server 侧 120s 懒过期兜底
		}
	}

	/** 审批中心列表（pending 优先返回全部状态，调用方过滤） */
	async list(conversationId?: string): Promise<ServerApprovalRow[]> {
		const query = conversationId !== undefined ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
		const body = await this.request("GET", `/v1/approvals${query}`, undefined, [200]);
		return (body.approvals as ServerApprovalRow[]) ?? [];
	}

	private async request(
		method: string,
		path: string,
		body: unknown,
		expect: number[],
	): Promise<Record<string, unknown>> {
		const token = await this.opts.getAccessToken();
		if (token === undefined) throw new Error("server 未登录");
		const response = await this.fetchImpl(`${this.opts.url}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${token}`,
				...(body !== undefined ? { "content-type": "application/json" } : {}),
			},
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		});
		if (expect.includes(response.status)) {
			if (response.status === 204 || method === "GET") return (await response.json()) as Record<string, unknown>;
			return (await response.json().catch(() => ({}))) as Record<string, unknown>;
		}
		const errorBody = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
		throw new Error(errorBody.message ?? `审批通道请求失败 ${response.status}`);
	}
}
