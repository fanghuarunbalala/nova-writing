import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LibraryService } from "../LibraryService.js";
import { BookImportService } from "../BookImportService.js";

/** 造临时目录 */
function tmpRoot(): string {
	const dir = join(tmpdir(), `book-import-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** 写样例源文件 */
function writeSample(root: string): string {
	const path = join(root, "书.txt");
	writeFileSync(path, ["第一章 启", "夜色落下，他提刀出门。", "第二章 转", "雨停了，桥上有人等他。"].join("\n"), "utf8");
	return path;
}

describe("BookImportService", () => {
	it("导入成功：spawner 收到 agentType/task/书库根 env，meta 置解析中", async () => {
		const root = tmpRoot();
		try {
			const spawns: unknown[] = [];
			const importer = new BookImportService({
				service: new LibraryService({ libraryRoot: root }),
				spawner: {
					async spawn(opts) {
						spawns.push(opts);
						return { conversationId: "conv-x" };
					},
				},
				libraryRoot: root,
			});
			const result = await importer.importBook({ sourcePath: writeSample(root) });
			expect(result.conversationId).toBe("conv-x");
			expect(spawns).toHaveLength(1);
			const spawn = spawns[0] as {
				agentType: string;
				task: { bookId: string; title?: string };
				extraEnv: Record<string, string>;
			};
			expect(spawn.agentType).toBe("BookAnalyst");
			expect(spawn.task.bookId).toBe(result.bookId);
			expect(spawn.task.title).toBeUndefined();
			expect(spawn.extraEnv.NOVEL_LIBRARY_ROOT).toBe(root);
			const meta = JSON.parse(
				readFileSync(join(root, result.bookId, "book.meta.json"), "utf8"),
			) as { status: string };
			expect(meta.status).toBe("解析中");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("spawn 失败：书本置解析失败（statusReason 记录），异常上抛，目录保留", async () => {
		const root = tmpRoot();
		try {
			const importer = new BookImportService({
				service: new LibraryService({ libraryRoot: root }),
				spawner: {
					async spawn() {
						throw new Error("连接报到超时");
					},
				},
				libraryRoot: root,
			});
			await expect(importer.importBook({ sourcePath: writeSample(root) })).rejects.toThrow(
				/报到超时/,
			);
			const dirs = readdirSync(root).filter((n) => n.startsWith("bk_"));
			expect(dirs).toHaveLength(1);
			const meta = JSON.parse(
				readFileSync(join(root, dirs[0], "book.meta.json"), "utf8"),
			) as { status: string; statusReason?: string };
			expect(meta.status).toBe("解析失败");
			expect(meta.statusReason).toContain("报到超时");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("spawnAnalysis=false：只导入不解析", async () => {
		const root = tmpRoot();
		try {
			let spawnCount = 0;
			const importer = new BookImportService({
				service: new LibraryService({ libraryRoot: root }),
				spawner: {
					async spawn() {
						spawnCount += 1;
						return { conversationId: "conv-y" };
					},
				},
				libraryRoot: root,
			});
			const result = await importer.importBook({
				sourcePath: writeSample(root),
				spawnAnalysis: false,
			});
			expect(spawnCount).toBe(0);
			expect(result.conversationId).toBeUndefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});