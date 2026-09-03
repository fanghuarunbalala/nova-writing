/**
 * RemoteNovelStore：云项目 novel 域后端（项目域上云 PRD FR6）。
 *
 * 架构——投影 + oplog 复制（不把域引擎搬到 server）：
 * - 本地投影：复用 InMemoryNovelStore（全部域语义：树/排序/级联/乐观锁原样）；
 * - server 权威：每个成功 mutation 作为一条 oplog 实体（kind=novel_mutation，data 含
 *   mutation 本身 + sessionTag）追加到 domain_entities，项目内 seq 全序；
 * - 收敛：启动 snapshot 全量重放；query 前按 seq 游标 delta 增量重放（本会话条目跳过
 *   ——本地已应用）；全端重放同序 → 投影一致；
 * - 并发写保护：域写发生在持租约会话内（lease 互斥），oplog 追加不互相冲突；
 * - 上推失败：本地已应用但 server 未记录 → 抛错（该会话写中断；server 仍权威，
 *   下次会话从 server 重放，本地发散不传播）。
 * 期 1 云项目离线不可写（与 RemoteProjectFiles 一致）。
 */
import { randomUUID } from "node:crypto";
import { InMemoryNovelStore } from "../novel/InMemoryNovelStore.js";
import type { NovelStore } from "../novel/store.js";
import type { NovelMutation } from "../novel/contract/mutation.js";
import type { NovelMutateResult } from "../novel/contract/snapshot.js";

export type RemoteStoreFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface RemoteNovelStoreOptions {
	url: string;
	projectId: string;
	/** 会话标签：本会话上推的 oplog 在 delta 重放时跳过（已本地应用） */
	sessionTag: string;
	getAccessToken: () => Promise<string | undefined>;
	/** 域写需租约（server domain/mutate 校验，对齐会话执行权） */
	getLeaseToken: () => string | undefined;
	getConversationId: () => string;
	fetchImpl?: RemoteStoreFetch;
	/** 重放单条失败时的钩子（schema 演进前向兼容：跳过并告警） */
	onReplaySkip?: (mutation: NovelMutation, cause: unknown) => void;
}

interface OplogEntity {
	id: string;
	kind: string;
	seq: number;
	data: { sessionTag: string; mutation: NovelMutation };
}

export class RemoteNovelStore implements NovelStore {
	private readonly projection = new InMemoryNovelStore();
	private readonly opts: RemoteNovelStoreOptions;
	private readonly fetchImpl: RemoteStoreFetch;
	private cursor = 0;
	private ready = false;

	constructor(options: RemoteNovelStoreOptions) {
		this.opts = options;
		this.fetchImpl = options.fetchImpl ?? ((i, j) => fetch(i, j));
	}

	/** 启动：snapshot 全量重放（首个 query 前自动调用） */
	async init(): Promise<void> {
		if (this.ready) return;
		const body = (await this.request("GET", `/domain/snapshot`)) as { cursor: number; entities: OplogEntity[] };
		this.cursor = 0;
		this.replay(body.entities);
		this.ready = true;
	}

	async query(q: Parameters<NovelStore["query"]>[0]): Promise<unknown> {
		await this.init();
		await this.sync();
		return this.projection.query(q);
	}

	async mutate(m: NovelMutation): Promise<NovelMutateResult> {
		const result = await this.projection.mutate(m);
		await this.upload([m]);
		return result;
	}

	async mutateBatch(ms: readonly NovelMutation[]): Promise<NovelMutateResult[]> {
		const results = await this.projection.mutateBatch(ms);
		await this.upload(ms);
		return results;
	}

	/** 增量重放（本会话条目跳过） */
	private async sync(): Promise<void> {
		const body = (await this.request("GET", `/domain/delta?since=${this.cursor}`)) as { cursor: number; entities: OplogEntity[] };
		this.replay(body.entities);
	}

	private async replay(entities: OplogEntity[]): Promise<void> {
		for (const e of entities) {
			this.cursor = Math.max(this.cursor, e.seq);
			if (e.kind !== "novel_mutation") continue;
			if (e.data?.sessionTag === this.opts.sessionTag) continue; // 本会话已应用
			try {
				await this.projection.mutate(e.data.mutation);
			} catch (cause) {
				this.opts.onReplaySkip?.(e.data.mutation, cause);
			}
		}
	}

	/** oplog 追加（批一次上行；失败抛错——server 权威不缺记） */
	private async upload(ms: readonly NovelMutation[]): Promise<void> {
		const mutations = ms.map((mutation) => ({
			kind: "novel_mutation",
			id: `m_${randomUUID()}`,
			op: "put" as const,
			data: { sessionTag: this.opts.sessionTag, mutation },
		}));
		const response = await this.request(
			"POST",
			"/domain/mutate",
			{ conversationId: this.opts.getConversationId(), leaseToken: this.opts.getLeaseToken(), mutations },
			[200],
		);
		void response;
	}

	private async request(method: string, path: string, body?: unknown, expectOk?: number[]): Promise<unknown> {
		const token = await this.opts.getAccessToken();
		if (token === undefined) throw new Error("server 未登录（云端项目不可用）");
		const leaseNeeded = method === "POST";
		let response: Response;
		try {
			response = await this.fetchImpl(`${this.opts.url.replace(/\/+$/, "")}/v1/projects/${encodeURIComponent(this.opts.projectId)}${path}`, {
				method,
				headers: {
					authorization: `Bearer ${token}`,
					...(body !== undefined ? { "content-type": "application/json" } : {}),
				},
				...(body !== undefined
					? {
							body: JSON.stringify(
								leaseNeeded && (body as Record<string, unknown>).leaseToken === undefined
									? { ...body, leaseToken: this.opts.getLeaseToken() }
									: body,
							),
						}
					: {}),
			});
		} catch (cause) {
			throw new Error(`无法连接 server（云端项目离线不可写）：${String(cause)}`);
		}
		if (response.status === 200 || (expectOk ?? [200]).includes(response.status)) {
			return response.status === 204 ? {} : ((await response.json()) as unknown);
		}
		const errorBody = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
		throw new Error(errorBody.message ?? `云项目域请求失败（HTTP ${response.status} ${errorBody.code ?? ""}）`);
	}
}
