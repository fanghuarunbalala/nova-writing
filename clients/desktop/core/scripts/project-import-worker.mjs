// 项目导入后台子进程入口：耗时操作（zip 解压 + 大文本解析 + 分批文件写 + 段落落库）
// 不在 Electron 主进程执行（会堵死事件循环致整个应用无响应），经 ImportProcessRunner
// spawn 本脚本完成。任务经 argv[2] 指向的 JSON 文件传入；stdout 按行输出协议：
//   {"type":"progress","stage":"...","done":n,"total":m}
//   {"type":"result","ok":true,"value":...} | {"type":"result","ok":false,"error":{"code","message"}}
import { readFileSync, rmSync } from "node:fs";
import { ProjectImportService } from "../dist/import/ProjectImportService.js";
import { SqliteNovelStore } from "../dist/novel/SqliteNovelStore.js";

const jobPath = process.argv[2];
if (jobPath === undefined) {
	process.stderr.write("project-import-worker: 缺少任务文件参数\n");
	process.exit(2);
}

const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const startedAt = Date.now();
// 诊断日志走 stderr（stdout 是行协议）——宿主 ImportProcessRunner 逐行转发进主日志
const log = (text) => process.stderr.write(`[import-worker ${new Date().toISOString()}] ${text}\n`);
let store;
try {
	const job = JSON.parse(readFileSync(jobPath, "utf8"));
	log(`started kind=${job.kind} source=${job.sourcePath ?? ""}`);
	const service = new ProjectImportService();
	if (job.kind === "prepare") {
		emit({ type: "progress", stage: "reading", done: 0, total: 0 });
		const preview = await service.prepare(job.sourcePath, {
			onProgress: (p) => emit({ type: "progress", ...p }),
		});
		emit({ type: "result", ok: true, value: preview });
	} else if (job.kind === "apply") {
		// 子进程自开 store（先确保 WAL——主进程也持有连接，WAL 多连接并存的既有先例
		// 见书库 BookAnalyst 直开 book.db）；完成即关，句柄不跨进程
		SqliteNovelStore.ensureWal(job.dbPath);
		store = new SqliteNovelStore(job.dbPath);
		const stats = await service.apply({
			workspaceRoot: job.workspaceRoot,
			store,
			sourcePath: job.sourcePath,
			plan: job.plan,
			onProgress: (p) => emit({ type: "progress", ...p }),
		});
		emit({ type: "result", ok: true, value: stats });
	} else {
		throw new Error(`未知任务类型：${String(job.kind)}`);
	}
	log(`finished ok kind=${job?.kind ?? "?"} elapsedMs=${Date.now() - startedAt}`);
} catch (err) {
	log(`failed: ${err instanceof Error ? err.message : String(err)}`);
	emit({
		type: "result",
		ok: false,
		error: {
			code: typeof err?.code === "string" ? err.code : "IMP_IMPORT_FAILED",
			message: err instanceof Error ? err.message : String(err),
		},
	});
	process.exitCode = 1;
} finally {
	try {
		store?.close();
	} catch {
		// 收尾关库失败不掩盖结果
	}
	rmSync(jobPath, { force: true });
}
