import { describe, expect, it, afterEach } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { LibraryService } from "../../LibraryService.js";
import { StylelibBuildRunner } from "../StylelibBuildRunner.js";
import type { StylelibBuildStats } from "../types.js";

/** fake worker 进程：按行协议回放消息后 close */
function fakeSpawnWorker(messages: ReadonlyArray<Record<string, unknown>>, spawnLog?: string[]) {
	return (() => {
		const spawnFn = (
			_cmd: string,
			args: readonly string[],
		): ChildProcess => {
			spawnLog?.push(args.join(" "));
			const child = new EventEmitter() as unknown as ChildProcess;
			child.stdout = new EventEmitter();
			child.stderr = new EventEmitter();
			child.pid = 4321;
			queueMicrotask(() => {
				for (const message of messages) {
					child.stdout?.emit("data", Buffer.from(`${JSON.stringify(message)}\n`));
				}
				child.emit("close", 0);
			});
			return child;
		};
		return spawnFn;
	})();
}

const STATS: StylelibBuildStats = {
	candidates: 30,
	batches: 3,
	failedBatches: 0,
	kept: 8,
	dropped: { notSubstring: 0, tooLong: 0, tooShort: 0, badTag: 0, badGroup: 0, duplicate: 0 },
	tags: { 对话吐槽: 8 },
	vectorless: false,
};

const KEY_ENV = "NOVEL_PROVIDER_API_KEY";

describe("StylelibBuildRunner", () => {
	afterEach(() => {
		delete process.env[KEY_ENV];
	});

	it("成功链：meta 建库中 → 已建（count/builtAt）；结果 = worker 上报 stats", async () => {
		process.env[KEY_ENV] = "test-key";
		const root = join(tmpdir(), `stylelib-runner-${randomUUID()}`);
		mkdirSync(root, { recursive: true });
		try {
			writeFileSync(join(root, "书.txt"), "第一章 启\n夜色落下，他提刀出门，走进很长的巷子里去。", "utf8");
			const service = new LibraryService({ libraryRoot: root });
			const { bookId } = await service.importBook({ sourcePath: join(root, "书.txt") });
			const spawns: string[] = [];
			const runner = new StylelibBuildRunner({
				service: () => service,
				workerScript: "stylelib-worker.mjs",
				spawnFn: fakeSpawnWorker(
					[
						{ type: "progress", done: 1, total: 3 },
						{ type: "result", ok: true, value: STATS },
					],
					spawns,
				) as never,
			});
			const stats = await runner.build(bookId);
			expect(stats.kept).toBe(8);
			expect(spawns).toHaveLength(1);
			const meta = JSON.parse(readFileSync(join(root, bookId, "book.meta.json"), "utf8")) as {
				stylelib?: { status: string; count?: number };
			};
			expect(meta.stylelib?.status).toBe("已建");
			expect(meta.stylelib?.count).toBe(8);
			service.close();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("worker 失败：meta 失败 + reason，异常上抛", async () => {
		process.env[KEY_ENV] = "test-key";
		const root = join(tmpdir(), `stylelib-runner-fail-${randomUUID()}`);
		mkdirSync(root, { recursive: true });
		try {
			writeFileSync(join(root, "书.txt"), "第一章 启\n夜色落下，他提刀出门，走进很长的巷子里去。", "utf8");
			const service = new LibraryService({ libraryRoot: root });
			const { bookId } = await service.importBook({ sourcePath: join(root, "书.txt") });
			const runner = new StylelibBuildRunner({
				service: () => service,
				workerScript: "stylelib-worker.mjs",
				spawnFn: fakeSpawnWorker([{ type: "result", ok: false, error: { message: "策展 provider 全挂" } }]) as never,
			});
			await expect(runner.build(bookId)).rejects.toThrow(/策展 provider 全挂/);
			const meta = JSON.parse(readFileSync(join(root, bookId, "book.meta.json"), "utf8")) as {
				stylelib?: { status: string; reason?: string };
			};
			expect(meta.stylelib?.status).toBe("失败");
			expect(meta.stylelib?.reason).toContain("策展 provider 全挂");
			service.close();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("无 provider key：不 spawn，直接标失败", async () => {
		delete process.env[KEY_ENV];
		const root = join(tmpdir(), `stylelib-runner-nokey-${randomUUID()}`);
		mkdirSync(root, { recursive: true });
		try {
			writeFileSync(join(root, "书.txt"), "第一章 启\n夜色落下，他提刀出门，走进很长的巷子里去。", "utf8");
			const service = new LibraryService({ libraryRoot: root });
			const { bookId } = await service.importBook({ sourcePath: join(root, "书.txt") });
			const spawns: string[] = [];
			const runner = new StylelibBuildRunner({
				service: () => service,
				workerScript: "stylelib-worker.mjs",
				spawnFn: fakeSpawnWorker([], spawns) as never,
			});
			await expect(runner.build(bookId)).rejects.toThrow(/NOVEL_PROVIDER_API_KEY/);
			expect(spawns).toHaveLength(0);
			const meta = JSON.parse(readFileSync(join(root, bookId, "book.meta.json"), "utf8")) as {
				stylelib?: { status: string };
			};
			expect(meta.stylelib?.status).toBe("失败");
			service.close();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("并发去重：同书并发 build 只 spawn 一次", async () => {
		process.env[KEY_ENV] = "test-key";
		const root = join(tmpdir(), `stylelib-runner-dedupe-${randomUUID()}`);
		mkdirSync(root, { recursive: true });
		try {
			writeFileSync(join(root, "书.txt"), "第一章 启\n夜色落下，他提刀出门，走进很长的巷子里去。", "utf8");
			const service = new LibraryService({ libraryRoot: root });
			const { bookId } = await service.importBook({ sourcePath: join(root, "书.txt") });
			const spawns: string[] = [];
			const runner = new StylelibBuildRunner({
				service: () => service,
				workerScript: "stylelib-worker.mjs",
				spawnFn: fakeSpawnWorker([{ type: "result", ok: true, value: STATS }], spawns) as never,
			});
			const [a, b] = await Promise.all([runner.build(bookId), runner.build(bookId)]);
			expect(a).toBe(b); // 同一 Promise
			expect(spawns).toHaveLength(1);
			service.close();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
