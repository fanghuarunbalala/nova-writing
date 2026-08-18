import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LibraryService, LibraryError } from "../LibraryService.js";
import { BookImportService, type AnalystConversationSpawner } from "../BookImportService.js";
import { createLibraryFace, type LibraryFaceDeps } from "../LibraryFace.js";
import { readLibraryAllowlist } from "../LibraryAccessPolicy.js";
import { toRPCError } from "../../rpc/call.js";

/** 造临时目录 */
function tmpRoot(tag: string): string {
	const dir = join(tmpdir(), `library-face-${tag}-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** 样例源文件 */
function writeSample(root: string, name = "样例书.txt"): string {
	const path = join(root, name);
	writeFileSync(path, "第一章 出门\n夜雨敲窗，他握刀立于巷口。\n\n第二章 行路\n路远，天亮之前要过桥。", "utf8");
	return path;
}

/** 直构 spawner（记录调用；失败注入用 throws 标记） */
function fakeSpawner(log: string[], opts?: { throws?: string }) {
	const spawner: AnalystConversationSpawner = {
		async spawn(request) {
			log.push(`${request.agentType}:${JSON.stringify(request.task)}`);
			if (opts?.throws !== undefined) throw new Error(opts.throws);
			return { conversationId: "conv_test" };
		},
	};
	return spawner;
}

/** 组装 face + 依赖件 */
function setup(tag: string, opts?: { importer?: boolean; spawnThrows?: string }) {
	const libraryRoot = tmpRoot(tag);
	const workspaceRoot = tmpRoot(`${tag}-ws`);
	const service = new LibraryService({ libraryRoot, workspaceRoot });
	const spawnLog: string[] = [];
	const importer =
		opts?.importer === true
			? new BookImportService({ service, spawner: fakeSpawner(spawnLog, { throws: opts?.spawnThrows }), libraryRoot })
			: undefined;
	const allowed = new Set<string>();
	const deps: LibraryFaceDeps = {
		service: () => service,
		workspaceRoot: () => workspaceRoot,
		...(importer !== undefined ? { importer: () => importer } : {}),
		pickFile: async () => null,
		allowedSources: () => allowed,
	};
	return { libraryRoot, workspaceRoot, service, importer, spawnLog, allowed, face: createLibraryFace(deps) };
}

describe("LibraryFace", () => {
	it("listBooks 经工作区书单过滤；导入自动授权（F10/F12）", async () => {
		const s = setup("auth");
		try {
			const sourcePath = writeSample(s.libraryRoot);
			s.allowed.add(sourcePath);
			const result = await s.face.importBook({ sourcePath, title: "样例" });
			// 导入即授权：书单文件写入 + listBooks 可见
			const allow = await readLibraryAllowlist(s.workspaceRoot);
			expect(allow.has(result.bookId)).toBe(true);
			const books = await s.face.listBooks();
			expect(books.map((b) => b.bookId)).toEqual([result.bookId]);
		} finally {
			rmSync(s.libraryRoot, { recursive: true, force: true });
			rmSync(s.workspaceRoot, { recursive: true, force: true });
		}
	});

	it("importBook：源路径不在白名单 → LIB_INVALID_ARGUMENT（经 toRPCError 映射业务码）", async () => {
		const s = setup("deny");
		try {
			const sourcePath = writeSample(s.libraryRoot);
			await expect(s.face.importBook({ sourcePath })).rejects.toThrow(LibraryError);
			await s.face.importBook({ sourcePath }).catch((err: unknown) => {
				const rpc = toRPCError(err, "library");
				expect(rpc.code).toBe("lib-invalid-argument");
			});
		} finally {
			rmSync(s.libraryRoot, { recursive: true, force: true });
			rmSync(s.workspaceRoot, { recursive: true, force: true });
		}
	});

	it("importBook：spawner 可用 + spawnAnalysis → 派生解析会话；spawnAnalysis=false → spawnSkipped", async () => {
		const s = setup("spawn", { importer: true });
		try {
			const sourcePath = writeSample(s.libraryRoot);
			s.allowed.add(sourcePath);
			const withSpawn = await s.face.importBook({ sourcePath: sourcePath, title: "甲" });
			expect(withSpawn.conversationId).toBe("conv_test");
			expect(withSpawn.spawnSkipped).toBeUndefined();
			expect(s.spawnLog[0]).toContain("BookAnalyst");

			const sourcePath2 = writeSample(s.libraryRoot, "乙书.txt");
			s.allowed.add(sourcePath2);
			const importOnly = await s.face.importBook({ sourcePath: sourcePath2, spawnAnalysis: false });
			expect(importOnly.conversationId).toBeUndefined();
			expect(importOnly.spawnSkipped).toContain("仅导入");
		} finally {
			rmSync(s.libraryRoot, { recursive: true, force: true });
			rmSync(s.workspaceRoot, { recursive: true, force: true });
		}
	});

	it("importBook：spawner 不可用时请求解析 → 降级仅导入（spawnSkipped 原因）", async () => {
		const s = setup("degrade");
		try {
			const sourcePath = writeSample(s.libraryRoot);
			s.allowed.add(sourcePath);
			const result = await s.face.importBook({ sourcePath });
			expect(result.conversationId).toBeUndefined();
			expect(result.spawnSkipped).toContain("解析会话不可用");
		} finally {
			rmSync(s.libraryRoot, { recursive: true, force: true });
			rmSync(s.workspaceRoot, { recursive: true, force: true });
		}
	});

	it("读面：readMeta/readManifest/readParagraphs/分析产物缺失业务码", async () => {
		const s = setup("read");
		try {
			const sourcePath = writeSample(s.libraryRoot);
			s.allowed.add(sourcePath);
			const { bookId } = await s.face.importBook({ sourcePath });
			const meta = await s.face.readMeta(bookId);
			expect(meta.status).toBe("解析中");
			const manifest = await s.face.readManifest(bookId);
			expect(manifest.length).toBeGreaterThan(0);
			const paras = await s.face.readParagraphs(bookId, { chapterNo: 1 });
			expect(paras.items[0]?.text).toContain("夜雨敲窗");
			// 分析产物未产出 → LIB_BOOK_NOT_FOUND 业务码
			await expect(s.face.readAnalysis(bookId, "style")).rejects.toThrow(LibraryError);
			await s.face.readAnalysis(bookId, "style").catch((err: unknown) => {
				expect(toRPCError(err, "library").code).toBe("lib-book-not-found");
			});
			// 未授权书 → LIB_BOOK_NOT_AUTHORIZED（不泄漏存在性）
			await expect(s.face.readMeta("bk_other1")).rejects.toThrow(LibraryError);
		} finally {
			rmSync(s.libraryRoot, { recursive: true, force: true });
			rmSync(s.workspaceRoot, { recursive: true, force: true });
		}
	});

	it("retryAnalysis：置解析中 + 派生新会话；spawner 不可用 → 业务错误", async () => {
		const s = setup("retry", { importer: true, spawnThrows: "first-fails" });
		try {
			const sourcePath = writeSample(s.libraryRoot);
			s.allowed.add(sourcePath);
			// 首次导入：spawn 失败 → 书本置解析失败（BookImportService 回写）+ importBook 抛错
			await expect(s.face.importBook({ sourcePath })).rejects.toThrow("first-fails");
			const [failed] = await s.face.listBooks();
			expect(failed?.status).toBe("解析失败");
			expect(failed?.statusReason).toContain("first-fails");
			// 重试：新 spawner 成功 → 解析中 + 新会话
			const ok = new BookImportService({
				service: s.service,
				spawner: fakeSpawner(s.spawnLog),
				libraryRoot: s.libraryRoot,
			});
			const deps2: LibraryFaceDeps = {
				service: () => s.service,
				workspaceRoot: () => s.workspaceRoot,
				importer: () => ok,
				allowedSources: () => s.allowed,
			};
			const face2 = createLibraryFace(deps2);
			const retried = await face2.retryAnalysis(failed!.bookId);
			expect(retried.conversationId).toBe("conv_test");
			const [running] = await face2.listBooks();
			expect(running?.status).toBe("解析中");
			expect(running?.statusReason).toBeUndefined();
			// 书单持久化仍含该书
			const allow = JSON.parse(readFileSync(join(s.workspaceRoot, ".novel", "library.json"), "utf8")) as { books: string[] };
			expect(allow.books).toContain(failed!.bookId);
		} finally {
			rmSync(s.libraryRoot, { recursive: true, force: true });
			rmSync(s.workspaceRoot, { recursive: true, force: true });
		}
	});
});
