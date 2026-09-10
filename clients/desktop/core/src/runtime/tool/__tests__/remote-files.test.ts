/**
 * RemoteProjectFiles 单元测试（FR5）：REST 形态、server 规则透传（NOVEL.md/memory）、
 * 轻量预检、离线错误、Glob 静态前缀；以及与 server 沙箱的「同输入同拒绝」对拍种子
 * （完整对拍在 cloud/server 包内跑真 server，见 files-parity.test）。
 */
import { describe, expect, it, vi } from "vitest";
import { RemoteProjectFiles } from "../../../cloud/RemoteProjectFiles.js";
import { createFileTools } from "../definitions/files.js";
import type { ToolCall } from "../../provider/types.js";

function callOf(name: string, args: Record<string, unknown>): ToolCall {
	return { id: "t1", name, args: JSON.stringify(args) };
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makeRemote(responder: (method: string, url: string, body: any) => Response | "throw-network") {
	const requests: Array<{ method: string; url: string; body: any }> = [];
	const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
		const method = init?.method ?? "GET";
		const body = init?.body !== undefined ? JSON.parse(String(init.body)) : undefined;
		requests.push({ method, url, body });
		const result = responder(method, url, body);
		if (result === "throw-network") throw new Error("ECONNREFUSED");
		return result;
	};
	return {
		requests,
		files: new RemoteProjectFiles({
			url: "http://srv:8787/",
			projectId: "prj_1",
			getAccessToken: async () => "jwt",
			fetchImpl,
		}),
	};
}

describe("RemoteProjectFiles", () => {
	it("read → GET files/<path>；write → PUT {content}（盲写）", async () => {
		const { requests, files } = makeRemote((method, url) => {
			if (method === "GET" && url.includes("/files/chapters/1.md")) {
				return jsonResponse(200, { path: "chapters/1.md", content: "第一章", updatedAt: 1 });
			}
			if (method === "PUT") return jsonResponse(200, { path: "x", updatedAt: 2 });
			return jsonResponse(404, { code: "not_found", message: "不存在" });
		});
		expect(await files.read("chapters/1.md")).toBe("第一章");
		await files.write("chapters/1.md", "改");
		expect(requests[0]!.url).toBe("http://srv:8787/v1/projects/prj_1/files/chapters/1.md");
		expect(requests[0]!.headers as never).toBeUndefined();
		expect(requests[1]!.method).toBe("PUT");
		expect(requests[1]!.body).toEqual({ content: "改" });
	});

	it("server 规则原样透传：NOVEL.md 403 / memory invalid_source / 404 文案", async () => {
		const { files } = makeRemote((method, url) => {
			if (url.includes("NOVEL.md")) return jsonResponse(403, { code: "novel_md_requires_approval", message: "NOVEL.md 只能经审批提案变更" });
			if (url.includes("memory/")) return jsonResponse(400, { code: "invalid_source", message: "source 必填且必须指向已存在的账本 seq" });
			return jsonResponse(404, { code: "not_found", message: "文件不存在" });
		});
		await expect(files.write("NOVEL.md", "x")).rejects.toThrow("审批提案");
		await expect(files.write("memory/a.md", "x")).rejects.toThrow("source 必填");
		await expect(files.read("chapters/ghost.md")).rejects.toThrow("不存在");
	});

	it("轻量预检：绝对路径/.. 本地早失败（不触网）", async () => {
		const { requests, files } = makeRemote(() => jsonResponse(200, {}));
		await expect(files.read("../escape.md")).rejects.toThrow("路径非法");
		await expect(files.write("/etc/passwd", "x")).rejects.toThrow("路径非法");
		expect(requests).toHaveLength(0);
	});

	it("离线：网络错误 → 中文错误（云端项目离线不可写）", async () => {
		const { files } = makeRemote(() => "throw-network");
		await expect(files.read("chapters/1.md")).rejects.toThrow("云端项目离线");
	});

	it("未登录：getAccessToken 空 → 直拒", async () => {
		const files = new RemoteProjectFiles({
			url: "http://srv", projectId: "p", getAccessToken: async () => undefined,
		});
		await expect(files.read("chapters/1.md")).rejects.toThrow("server 未登录");
	});

	it("经 createFileTools 组装：Glob 用静态前缀列表 + updatedAt 倒序", async () => {
		const { requests, files } = makeRemote((method, url) => {
			if (url.includes("/files?prefix=chapters%2F")) {
				return jsonResponse(200, {
					files: [
						{ path: "chapters/1.md", updatedAt: 10 },
						{ path: "chapters/2.md", updatedAt: 20 },
						{ path: "other/x.md", updatedAt: 99 },
					],
				});
			}
			return jsonResponse(404, {});
		});
		const glob = createFileTools(files).find((t) => t.name === "Glob")!;
		const out = await glob.handler.execute(callOf("Glob", { pattern: "chapters/*.md" }));
		expect(out).toBe("chapters/2.md\nchapters/1.md");
		// 静态前缀已把列举面缩到 chapters/（other/x.md 不应出现，也无需全量拉取）
		expect(requests[0]!.url).toContain("prefix=chapters%2F");
	});

	it("Edit：read-modify-write 走同一后端", async () => {
		let content = "旧句子";
		const seen: string[] = [];
		const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
			if (init?.method === "PUT") {
				seen.push(String(init.body));
				content = JSON.parse(String(init.body)).content;
				return jsonResponse(200, {});
			}
			if (url.includes("/files/notes/a.md")) return jsonResponse(200, { content, updatedAt: 1 });
			return jsonResponse(404, {});
		};
		const files = new RemoteProjectFiles({ url: "http://srv", projectId: "p", getAccessToken: async () => "t", fetchImpl });
		const edit = createFileTools(files).find((t) => t.name === "Edit")!;
		const out = await edit.handler.execute(callOf("Edit", { file_path: "notes/a.md", old_string: "旧", new_string: "新" }));
		expect(out).toContain("已替换");
		expect(seen[0]).toContain("新句子");
	});
});
