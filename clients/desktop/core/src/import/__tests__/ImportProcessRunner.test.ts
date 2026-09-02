import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ImportProcessRunner } from "../ImportProcessRunner.js";
import { ImportError } from "../ImportError.js";

/** 简单等待（时序观察 activeJob 用） */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ImportProcessRunner 协议回归（假 worker 脚本驱动——CI 的 core job 无 dist 也能跑；
 * 真脚本 dist-guarded 用例见文末）。行协议：progress（activeJob 更新）/ result（终态）。
 */

/** 造临时目录 */
function tmpRoot(): string {
	const dir = join(tmpdir(), `import-runner-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** 写一个假 worker 脚本（读 argv[2] 任务文件；按预设行为输出行协议） */
function writeFakeWorker(root: string, behavior: "ok" | "error" | "crash" | "slow"): string {
	const script = [
		"import { readFileSync } from 'node:fs';",
		"const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));",
		"const emit = (o) => process.stdout.write(JSON.stringify(o) + '\\n');",
		...(behavior === "crash"
			? [
					"process.stderr.write('boom crash');",
					"process.exit(3);",
				]
			: []),
		...(behavior === "ok" || behavior === "slow"
			? [
					"emit({ type: 'progress', stage: 'parsing', done: 0, total: 0 });",
					"await new Promise((r) => setTimeout(r, 20));",
					"emit({ type: 'progress', stage: 'writing-db', done: 2, total: 5 });",
					// 观察窗口：进度与终态之间留足时间（Windows 子进程启动可达数百 ms）
					behavior === "slow"
						? "await new Promise((r) => setTimeout(r, 1200));"
						: "await new Promise((r) => setTimeout(r, 800));",
					"emit({ type: 'result', ok: true, value: { echo: job.kind } });",
				]
			: []),
		...(behavior === "error"
			? [
					"emit({ type: 'result', ok: false, error: { code: 'IMP_INVALID_ARGUMENT', message: '源文件与预览时不一致' } });",
				]
			: []),
	].join("\n");
	const path = join(root, `worker-${behavior}-${randomUUID()}.mjs`);
	writeFileSync(path, script, "utf8");
	return path;
}

describe("ImportProcessRunner（后台子进程执行器）", () => {
	it("成功路径：resolve 值 + activeJob 过程可见、结束清空", async () => {
		const root = tmpRoot();
		const runner = new ImportProcessRunner({
			workerScript: writeFakeWorker(root, "ok"),
		});
		const pending = runner.prepare("D:/some/旧稿.txt");
		try {
			const deadline = Date.now() + 10_000;
			while (runner.activeJob()?.stage !== "writing-db" && Date.now() < deadline) {
				await sleep(50);
			}
			expect(runner.activeJob()).toMatchObject({ stage: "writing-db", done: 2, total: 5 });
			await expect(pending).resolves.toEqual({ echo: "prepare" });
			expect(runner.activeJob()).toBeUndefined();
		} finally {
			// 先等子进程收口再删目录（断言失败提前跳出时防孤儿进程加载已删脚本）
			await pending.catch(() => {});
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("业务错误：result ok=false → ImportError（code/message 保留）", async () => {
		const root = tmpRoot();
		try {
			const runner = new ImportProcessRunner({
				workerScript: writeFakeWorker(root, "error"),
			});
			const rejection = runner.prepare("x");
			await expect(rejection).rejects.toThrow(/不一致/);
			const err = await rejection.catch((e: unknown) => e);
			expect(err).toBeInstanceOf(ImportError);
			expect((err as ImportError).code).toBe("IMP_INVALID_ARGUMENT");
			expect(runner.activeJob()).toBeUndefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("子进程崩溃（无 result 行）：归一为 IMP_IMPORT_FAILED 且含退出信息", async () => {
		const root = tmpRoot();
		try {
			const runner = new ImportProcessRunner({
				workerScript: writeFakeWorker(root, "crash"),
			});
			await expect(runner.prepare("x")).rejects.toThrow(/后台进程退出.*code=3/s);
			expect(runner.activeJob()).toBeUndefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("单任务串行：任务进行中再发起直接拒绝", async () => {
		const root = tmpRoot();
		try {
			const runner = new ImportProcessRunner({
				workerScript: writeFakeWorker(root, "slow"),
			});
			const pending = runner.prepare("a");
			await sleep(60);
			await expect(runner.prepare("b")).rejects.toThrow(/已有导入任务进行中/);
			await expect(pending).resolves.toEqual({ echo: "prepare" });
			// 结束后可再次执行
			await expect(runner.prepare("c")).resolves.toEqual({ echo: "prepare" });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

/** 真脚本集成（依赖 core/dist——CI core job 无构建时跳过；本地/构建后生效） */
const realWorkerScript = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../../scripts/project-import-worker.mjs",
);
const distBuilt = existsSync(join(dirname(fileURLToPath(import.meta.url)), "../../../dist/index.js"));

describe.skipIf(!distBuilt)("ImportProcessRunner × 真实 worker 脚本", () => {
	it("prepare：后台进程解析样例返回预览", async () => {
		const root = tmpRoot();
		try {
			const sourcePath = join(root, "旧稿.txt");
			writeFileSync(
				sourcePath,
				["第一章 启", "夜色落下，他提刀出门。", "第二章 转", "雨停了，桥上有人等他。"].join("\n"),
				"utf8",
			);
			const runner = new ImportProcessRunner({ workerScript: realWorkerScript });
			const preview = await runner.prepare(sourcePath);
			expect(preview.kind).toBe("txt");
			expect(preview.chapters.map((c) => c.title)).toEqual(["第一章 启", "第二章 转"]);
			expect(runner.activeJob()).toBeUndefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("apply：后台进程落库 SqliteNovelStore 并返回统计", async () => {
		const root = tmpRoot();
		try {
			const sourcePath = join(root, "旧稿.txt");
			writeFileSync(
				sourcePath,
				["第一章 启", "夜色落下，他提刀出门。", "第二章 转", "雨停了，桥上有人等他。"].join("\n"),
				"utf8",
			);
			const runner = new ImportProcessRunner({ workerScript: realWorkerScript });
			const preview = await runner.prepare(sourcePath);
			const workspaceRoot = join(root, "proj");
			mkdirSync(workspaceRoot, { recursive: true });
			const dbPath = join(workspaceRoot, "novel.db");
			const stats = await runner.apply({
				workspaceRoot,
				dbPath,
				sourcePath,
				plan: preview,
			});
			expect(stats).toMatchObject({ chapters: 2, batches: 2 });
			// 落库产物可直接由 Sqlite store 读出（卷章 + 段落选择）
			const { SqliteNovelStore } = await import("../../novel/SqliteNovelStore.js");
			const store = new SqliteNovelStore(dbPath);
			try {
				const pub = (await store.query({ op: "publication.get" })) as {
					volumes: unknown[];
					chapters: unknown[];
				};
				expect(pub.chapters).toHaveLength(2);
			} finally {
				store.close();
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
