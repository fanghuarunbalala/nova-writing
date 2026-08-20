/**
 * ImportProcessRunner：项目导入耗时操作的后台子进程执行器。
 * 预览解析与落库（zip 解压、大文本解析、分批文件写、段落事务插入）若在 Electron
 * 主进程同步执行会堵死事件循环（窗口/IPC 全无响应）——这里 spawn
 * core/scripts/project-import-worker.mjs（ELECTRON_RUN_AS_NODE，desktop-child 同款
 * 部署模式）完成，主进程只做编排；阶段进度经 activeJob() 轮询（createProgress RPC）。
 * stdout 行协议：progress（阶段更新）/ result（终态，ok 值或 error）。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Logger } from "../log/Logger.js";
import { ImportError } from "./ImportError.js";
import type { ImportJobProgress, ImportPlan, ImportPreview, ImportStats } from "./ImportTypes.js";

/** 后台执行面（ImportFace 依赖；ProjectImportService 为其同步参照实现） */
export interface ProjectImportRunner {
	/** 预览（后台进程执行） */
	prepare(sourcePath: string): Promise<ImportPreview>;
	/** 落库（后台进程执行；子进程自开 dbPath 的 store） */
	apply(input: {
		workspaceRoot: string;
		dbPath: string;
		sourcePath: string;
		plan: ImportPlan;
	}): Promise<ImportStats>;
	/** 当前任务进度（无进行中任务 = undefined） */
	activeJob(): ImportJobProgress | undefined;
}

/** worker stdout 行协议消息 */
type WorkerMessage =
	| { type: "progress"; stage: ImportJobProgress["stage"]; done?: number; total?: number }
	| { type: "result"; ok: true; value: unknown }
	| { type: "result"; ok: false; error: { code?: string; message?: string } };

/** ImportProcessRunner 构造选项 */
export interface ImportProcessRunnerOptions {
	/** worker 脚本绝对路径（core/scripts/project-import-worker.mjs；随构建布局由宿主解析） */
	workerScript: string;
	/** 结构化日志（spawn/阶段变化/stderr 转发/终态；缺省静默） */
	logger?: Logger;
}

/**
 * 后台子进程执行器（单任务串行：导入流程本身独占，并发请求直接拒绝）
 */
export class ImportProcessRunner implements ProjectImportRunner {
	private readonly workerScript: string;
	private readonly logger?: Logger;
	private active: ImportJobProgress | undefined;
	/** 已打日志的阶段（阶段变化才记一条，防批量进度刷屏；任务结束重置） */
	private lastLoggedStage: string | undefined;

	constructor(options: ImportProcessRunnerOptions) {
		this.workerScript = options.workerScript;
		this.logger = options.logger?.child({ component: "import_worker" });
	}

	activeJob(): ImportJobProgress | undefined {
		return this.active;
	}

	async prepare(sourcePath: string): Promise<ImportPreview> {
		const value = await this.run({ kind: "prepare", sourcePath });
		return value as ImportPreview;
	}

	async apply(input: {
		workspaceRoot: string;
		dbPath: string;
		sourcePath: string;
		plan: ImportPlan;
	}): Promise<ImportStats> {
		const value = await this.run({ kind: "apply", ...input });
		return value as ImportStats;
	}

	/** 执行一个任务：写 job 文件 → spawn → 行协议收敛 → 清理 */
	private run(job: Record<string, unknown>): Promise<unknown> {
		if (this.active !== undefined) {
			return Promise.reject(new ImportError("IMP_INVALID_ARGUMENT", "已有导入任务进行中，请稍候"));
		}
		this.active = { stage: "reading", done: 0, total: 0 };
		const jobDir = mkdtempSync(join(tmpdir(), "project-import-job-"));
		const jobPath = join(jobDir, "job.json");
		writeFileSync(jobPath, JSON.stringify(job), "utf8");
		return new Promise<unknown>((resolve, reject) => {
			let settled = false;
			const startedAt = Date.now();
			this.lastLoggedStage = undefined;
			const finish = (fn: () => void): void => {
				if (settled) return;
				settled = true;
				this.active = undefined;
				rmSync(jobDir, { recursive: true, force: true });
				fn();
			};
			let child: ChildProcess;
			try {
				child = spawn(process.execPath, [this.workerScript, jobPath], {
					stdio: ["ignore", "pipe", "pipe"],
					// Electron main 的 execPath 是 electron.exe：RUN_AS_NODE 使其按纯 Node
					// 运行脚本（纯 Node 环境下该变量无副作用）
					env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
				});
			} catch (err) {
				finish(() =>
					reject(
						new ImportError(
							"IMP_IMPORT_FAILED",
							`导入后台进程启动失败：${err instanceof Error ? err.message : String(err)}`,
						),
					),
				);
				return;
			}
			this.logger?.info("import_worker.spawn", {
				script: this.workerScript,
				pid: child.pid,
				kind: job.kind,
			});
			let stdoutText = "";
			let stderrText = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdoutText += chunk.toString("utf8");
				// 逐行解析（保留半行等下一个 chunk）
				const lines = stdoutText.split(/\r?\n/);
				stdoutText = lines.pop() ?? "";
				for (const line of lines) {
					if (line.trim().length === 0) continue;
					this.handleLine(line, finish, resolve, reject);
				}
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				const text = chunk.toString("utf8");
				stderrText = (stderrText + text).slice(-4096);
				// 子进程 stderr 逐行实时转发日志（诊断卡死/崩溃的关键观测面）
				for (const line of text.split(/\r?\n/)) {
					if (line.trim().length > 0) this.logger?.info("import_worker.stderr", { text: line });
				}
			});
			child.on("error", (err) => {
				this.logger?.error("import_worker.done", { ok: false, elapsedMs: Date.now() - startedAt, error: err.message });
				finish(() =>
					reject(
						new ImportError(
							"IMP_IMPORT_FAILED",
							`导入后台进程异常：${err.message}`,
						),
					),
				);
			});
			child.on("close", (code) => {
				// 冲刷残余半行（worker 每条消息都带换行，正常不出现；出现则尝试解析）
				if (stdoutText.trim().length > 0) {
					this.handleLine(stdoutText, finish, resolve, reject);
				}
				if (!settled) {
					this.logger?.error("import_worker.done", {
						ok: false,
						elapsedMs: Date.now() - startedAt,
						code,
						stderr: stderrText.trim().slice(0, 500),
					});
					finish(() =>
						reject(
							new ImportError(
								"IMP_IMPORT_FAILED",
								`导入后台进程退出（code=${code ?? "unknown"}）${stderrText.length > 0 ? `：${stderrText.trim().slice(0, 500)}` : ""}`,
							),
						),
					);
				}
			});
		});
	}

	/** 单行协议消息处理（stage 变化打日志） */
	private handleLine(
		line: string,
		finish: (fn: () => void) => void,
		resolve: (value: unknown) => void,
		reject: (err: unknown) => void,
	): void {
		let message: WorkerMessage;
		try {
			message = JSON.parse(line) as WorkerMessage;
		} catch {
			return; // 非 JSON 行（意外输出）忽略
		}
		if (message?.type === "progress") {
			this.active = {
				stage: message.stage,
				done: typeof message.done === "number" ? message.done : 0,
				total: typeof message.total === "number" ? message.total : 0,
			};
			if (message.stage !== this.lastLoggedStage) {
				this.lastLoggedStage = message.stage;
				this.logger?.info("import_worker.stage", { ...this.active });
			}
			return;
		}
		if (message?.type === "result") {
			if (message.ok) {
				this.logger?.info("import_worker.result", { ok: true });
				finish(() => resolve(message.value));
			} else {
				const code = message.error?.code;
				this.logger?.warn("import_worker.result", {
					ok: false,
					code,
					message: message.error?.message,
				});
				finish(() =>
					reject(
						new ImportError(
							code === "IMP_INVALID_ARGUMENT" ||
								code === "IMP_PROJECT_NOT_EMPTY" ||
								code === "IMP_NOT_FOUND"
								? code
								: "IMP_IMPORT_FAILED",
							message.error?.message ?? "导入失败",
						),
					),
				);
			}
		}
	}
}
