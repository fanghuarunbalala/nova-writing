/**
 * RemoteProjectFiles：云项目文件后端（项目域上云 PRD FR5）。
 * - REST 到 server 文件 API（GET/PUT /v1/projects/:id/files/*，GET ?prefix= 列表）；
 * - 沙箱由 server 权威判定（sandbox.ts），客户端只做轻量预检（绝对/.. 早失败省一次往返）；
 * - 工具面语义与 LocalProjectFiles 对齐：read 全文、write last-write-wins、list prefix；
 * - 离线：网络错误抛中文错误（期 1 云项目不做离线写）。
 */

import type { ProjectFiles } from "../runtime/tool/definitions/files.js";

export type RemoteFilesFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface RemoteProjectFilesOptions {
	url: string;
	projectId: string;
	getAccessToken: () => Promise<string | undefined>;
	fetchImpl?: RemoteFilesFetch;
}

interface FileErrorBody {
	code?: string;
	message?: string;
}

async function errorFromResponse(response: Response, fallback: string): Promise<Error> {
	const body = (await response.json().catch(() => ({}))) as FileErrorBody;
	return new Error(body.message ?? `${fallback}（HTTP ${response.status}）`);
}

export class RemoteProjectFiles implements ProjectFiles {
	private readonly baseUrl: string;
	private readonly projectId: string;
	private readonly getAccessToken: () => Promise<string | undefined>;
	private readonly fetchImpl: RemoteFilesFetch;

	constructor(options: RemoteProjectFilesOptions) {
		this.baseUrl = options.url.replace(/\/+$/, "");
		this.projectId = options.projectId;
		this.getAccessToken = options.getAccessToken;
		this.fetchImpl = options.fetchImpl ?? ((i, j) => fetch(i, j));
	}

	async read(relPath: string): Promise<string> {
		this.precheck(relPath);
		const response = await this.request("GET", `/files/${encodePath(relPath)}`);
		if (response.status === 200) {
			const body = (await response.json()) as { content?: string };
			if (typeof body.content !== "string") throw new Error("server 返回的文件内容缺失");
			return body.content;
		}
		if (response.status === 404) throw new Error(`文件 ${relPath} 不存在`);
		throw await errorFromResponse(response, `读取 ${relPath} 失败`);
	}

	async list(prefix: string): Promise<Array<{ path: string; updatedAt: number }>> {
		const response = await this.request("GET", `/files${prefix !== "" ? `?prefix=${encodeURIComponent(prefix)}` : ""}`);
		if (response.status !== 200) throw await errorFromResponse(response, "列出文件失败");
		const body = (await response.json()) as { files?: Array<{ path: string; updatedAt?: number }> };
		return (body.files ?? []).map((f) => ({ path: f.path, updatedAt: f.updatedAt ?? 0 }));
	}

	async write(relPath: string, content: string): Promise<void> {
		this.precheck(relPath);
		const response = await this.request("PUT", `/files/${encodePath(relPath)}`, { content });
		if (response.status === 200) return;
		// NOVEL.md 审批唯一写径 / memory source 校验等 server 规则原样透传给模型
		throw await errorFromResponse(response, `写入 ${relPath} 被拒`);
	}

	private async request(method: string, path: string, body?: unknown): Promise<Response> {
		const token = await this.getAccessToken();
		if (token === undefined) throw new Error("server 未登录（云端项目不可用）");
		try {
			return await this.fetchImpl(`${this.baseUrl}/v1/projects/${encodeURIComponent(this.projectId)}${path}`, {
				method,
				headers: {
					authorization: `Bearer ${token}`,
					...(body !== undefined ? { "content-type": "application/json" } : {}),
				},
				...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			});
		} catch (cause) {
			throw new Error(`无法连接 server（云端项目离线不可写）：${String(cause)}`);
		}
	}

	/** 轻量预检：明显非法的路径本地早失败（权威判定仍在 server） */
	private precheck(relPath: string): void {
		if (relPath.startsWith("/") || relPath.includes("..") || relPath.includes("\0")) {
			throw new Error(`路径非法: ${relPath}`);
		}
	}
}

/** 路径逐段 encodeURIComponent（保留 / 分隔），防止 .. 与段内特殊字符在路由层变形 */
function encodePath(relPath: string): string {
	return relPath.split("/").map(encodeURIComponent).join("/");
}
