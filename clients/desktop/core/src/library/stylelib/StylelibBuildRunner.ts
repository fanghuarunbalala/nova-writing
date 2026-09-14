/**
 * stylelib 建库后台执行器（ImportProcessRunner 同款一次性子进程模式）：
 * 任务 JSON 经 argv 传给 stylelib-worker.mjs（ELECTRON_RUN_AS_NODE），stdout 行协议
 * progress/result；策展 LLM（~100 次调用）与 ONNX 嵌入都在子进程完成，主进程零占用。
 * meta 的 stylelib 状态由本执行器维护（建库中 → 已建/失败，回写失败不阻塞）；
 * 每书串行（并发去重），跨书可并行。无 provider key 时标失败不 spawn。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "../../log/Logger.js";
import type { LibraryService } from "../LibraryService.js";
import type { StylelibBuildStats } from "./types.js";

/** worker stdout 行协议消息 */
type WorkerMessage =
	| { type: "progress"; done?: number; total?: number }
	| { type: "result"; ok: true; value: StylelibBuildStats }
	| { type: "result"; ok: false; error?: { message?: string } };

/** 构造选项 */
export interface StylelibBuildRunnerOptions {
	/** 书库服务（meta 状态回写；getter 形态支持 GUI 工作区热重绑） */
	service: () => LibraryService;
	/** worker 脚本绝对路径（core/scripts/stylelib-worker.mjs；随构建布局由宿主解析） */
	workerScript: string;
	/** 结构化日志（缺省静默） */
	logger?: Logger;
	/** spawn 注入面（测试用；缺省 node:child_process） */
	spawnFn?: typeof spawn;
}

/**
 * 建库后台执行器
 */
export class StylelibBuildRunner {
	private readonly service: () => LibraryService;
	private readonly workerScript: string;
	private readonly logger?: Logger;
	private readonly spawnFn: typeof spawn;
	/** 进行中任务（bookId → Promise；并发去重） */
	private readonly active = new Map<string, Promise<StylelibBuildStats>>();

	constructor(options: StylelibBuildRunnerOptions) {
		this.service = options.service;
		this.workerScript = options.workerScript;
		this.logger = options.logger?.child({ component: "stylelib_worker" });
		this.spawnFn = options.spawnFn ?? spawn;
	}

	/**
	 * 建库（每书串行；状态回写 meta）
	 * @param bookId 书 id
	 * @param target 候选组数目标（缺省 worker 侧默认）
	 * @returns 建库统计
	 */
	build(bookId: string, target?: number): Promise<StylelibBuildStats> {
		const running = this.active.get(bookId);
		if (running !== undefined) return running;
		const promise = this.run(bookId, target).finally(() => {
			this.active.delete(bookId);
		});
		this.active.set(bookId, promise);
		return promise;
	}

	/** 执行一次建库：前置校验 → meta 建库中 → spawn worker → 行协议收敛 → 回写终态 */
	private async run(bookId: string, target?: number): Promise<StylelibBuildStats> {
		const service = this.service();
		if ((process.env.NOVEL_PROVIDER_API_KEY ?? "").trim() === "") {
			await service
				.updateBookMeta(bookId, { stylelib: { status: "失败", reason: "无 provider 配置（NOVEL_PROVIDER_API_KEY 缺失）" } })
				.catch(() => {});
			throw new Error("stylelib 建库不可用（缺 NOVEL_PROVIDER_API_KEY）");
		}
		await service.updateBookMeta(bookId, { stylelib: { status: "建库中" } }).catch(() => {});
		const jobDir = mkdtempSync(join(tmpdir(), "stylelib-job-"));
		const jobPath = join(jobDir, "job.json");
		const libraryRoot = service.libraryRoot;
		writeFileSync(jobPath, JSON.stringify({ libraryRoot, bookId, ...(target !== undefined ? { target } : {}) }), "utf8");
		try {
			const stats = await new Promise<StylelibBuildStats>((resolve, reject) => {
				let settled = false;
				const finish = (fn: () => void): void => {
					if (settled) return;
					settled = true;
					fn();
				};
				let child: ChildProcess;
				try {
					child = this.spawnFn(process.execPath, [this.workerScript, jobPath], {
						stdio: ["ignore", "pipe", "pipe"],
						// Electron main 的 execPath 是 electron.exe：RUN_AS_NODE 使其按纯 Node 运行
						env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
					});
				} catch (err) {
					finish(() =>
						reject(new Error(`stylelib 建库进程启动失败：${err instanceof Error ? err.message : String(err)}`)),
					);
					return;
				}
				this.logger?.info("stylelib_worker.spawn", { script: this.workerScript, pid: child.pid, bookId });
				let stdoutText = "";
				let stderrText = "";
				let lastProgress = "";
				child.stdout?.on("data", (chunk: Buffer) => {
					stdoutText += chunk.toString("utf8");
					const lines = stdoutText.split(/\r?\n/);
					stdoutText = lines.pop() ?? "";
					for (const line of lines) {
						if (line.trim().length === 0) continue;
						const handled = this.handleLine(line, finish, resolve, reject);
						if (handled !== undefined) lastProgress = handled;
					}
				});
				child.stderr?.on("data", (chunk: Buffer) => {
					const text = chunk.toString("utf8");
					stderrText = (stderrText + text).slice(-4096);
					for (const line of text.split(/\r?\n/)) {
						if (line.trim().length > 0) this.logger?.info("stylelib_worker.stderr", { text: line });
					}
				});
				child.on("error", (err) => {
					finish(() => reject(new Error(`stylelib 建库进程异常：${err.message}`)));
				});
				child.on("close", (code) => {
					if (stdoutText.trim().length > 0) {
						this.handleLine(stdoutText, finish, resolve, reject);
					}
					finish(() => {
						reject(
							new Error(
								`stylelib 建库进程退出（code=${code ?? "unknown"}${stderrText.length > 0 ? `：${stderrText.trim().slice(0, 500)}` : ""}）${lastProgress}`,
							),
						);
					});
				});
			});
			await service
				.updateBookMeta(bookId, {
					stylelib: {
						status: "已建",
						count: stats.kept,
						builtAt: new Date().toISOString(),
						...(stats.vectorless ? { vectorless: true } : {}),
					},
				})
				.catch(() => {});
			this.logger?.info("stylelib_worker.done", { bookId, kept: stats.kept, vectorless: stats.vectorless });
			return stats;
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			await service
				.updateBookMeta(bookId, {
					stylelib: { status: "失败", ...(reason.length > 0 ? { reason: reason.slice(0, 500) } : {}) },
				})
				.catch(() => {});
			throw err;
		} finally {
			rmSync(jobDir, { recursive: true, force: true });
		}
	}

	/** 单行协议消息处理（result 终态收敛；progress 返回摘要供退出诊断） */
	private handleLine(
		line: string,
		finish: (fn: () => void) => void,
		resolve: (stats: StylelibBuildStats) => void,
		reject: (err: unknown) => void,
	): string | undefined {
		let message: WorkerMessage;
		try {
			message = JSON.parse(line) as WorkerMessage;
		} catch {
			return undefined; // 非 JSON 行（意外输出）忽略
		}
		if (message?.type === "progress") {
			const summary = `${message.done ?? 0}/${message.total ?? 0}`;
			this.logger?.info("stylelib_worker.progress", { summary });
			return summary;
		}
		if (message?.type === "result") {
			if (message.ok) {
				finish(() => resolve(message.value));
			} else {
				finish(() => reject(new Error(message.error?.message ?? "stylelib 建库失败")));
			}
		}
		return undefined;
	}
}
