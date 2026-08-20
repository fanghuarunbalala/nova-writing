import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { InMemoryNovelStore } from "../../novel/InMemoryNovelStore.js";
import { ProjectImportService } from "../ProjectImportService.js";
import { createProjectImportFace, type FreshWorkspaceSession, type ProjectImportFaceDeps } from "../ImportFace.js";
import { importMetaPath } from "../ImportPaths.js";
import type { ImportConversationSpawner } from "../ImportFace.js";
import type { ProjectImportRunner } from "../ImportProcessRunner.js";
import type { ImportJobProgress, ImportJobStatus } from "../ImportTypes.js";

/** 轮询 createProgress 至终态（任务式 create 的测试等待面） */
async function waitTerminalJob(
	face: ReturnType<typeof createProjectImportFace>,
): Promise<ImportJobStatus> {
	const deadline = Date.now() + 10_000;
	for (;;) {
		const status = await face.createProgress();
		if (status !== null && status.phase !== "running") return status;
		if (Date.now() > deadline) throw new Error("等待导入任务终态超时（10s）");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

/** 造临时目录 */
function tmpRoot(): string {
	const dir = join(tmpdir(), `import-face-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writeSampleTxt(root: string): string {
	const path = join(root, "旧稿.txt");
	writeFileSync(
		path,
		["第一章 启", "夜色落下，他提刀出门。", "第二章 转", "雨停了，桥上有人等他。"].join("\n"),
		"utf8",
	);
	return path;
}

/** 桩工作区会话（真实临时目录 + 内存 store；commit/rollback 记录调用） */
function stubSession(workspaceRoot: string): FreshWorkspaceSession & { calls: string[] } {
	mkdirSync(workspaceRoot, { recursive: true });
	const calls: string[] = [];
	return {
		workspaceRoot,
		store: new InMemoryNovelStore(),
		dbPath: join(workspaceRoot, "novel.db"),
		commit: async () => {
			calls.push("commit");
		},
		rollback: async () => {
			calls.push("rollback");
		},
		calls,
	};
}

function buildFace(
	root: string,
	sourcePath: string,
	options?: { spawner?: ImportConversationSpawner; runner?: ProjectImportRunner },
) {
	const workspaceRoot = join(root, "proj");
	const session = stubSession(workspaceRoot);
	const service = new ProjectImportService();
	const face = createProjectImportFace({
		service,
		...(options?.runner !== undefined ? { runner: () => options.runner! } : {}),
		allowedSources: () => new Set([sourcePath]),
		createWorkspaceDir: async () => ({ referenceId: workspaceRoot, label: "proj" }),
		bindFreshWorkspace: async () => session,
		...(options?.spawner !== undefined ? { spawner: () => options.spawner! } : {}),
		workspaceRoot: () => workspaceRoot,
		store: () => session.store,
	});
	return { face, service, session, workspaceRoot };
}

describe("ImportFace（项目导入 RPC 编排）", () => {
	it("未授权路径被拒", async () => {
		const root = tmpRoot();
		try {
			const sourcePath = writeSampleTxt(root);
			const { face } = buildFace(root, sourcePath);
			await expect(face.previewImport("D:/未授权.txt")).rejects.toThrow(/授权/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("save 对话框取消 → canceled（无副作用、不 commit）", async () => {
		const root = tmpRoot();
		try {
			const sourcePath = writeSampleTxt(root);
			const service = new ProjectImportService();
			const face = createProjectImportFace({
				service,
				allowedSources: () => new Set([sourcePath]),
				createWorkspaceDir: async () => undefined,
				bindFreshWorkspace: async () => {
					throw new Error("不应绑定");
				},
				workspaceRoot: () => undefined,
				store: () => new InMemoryNovelStore(),
			});
			const plan = await service.prepare(sourcePath);
			await expect(
				face.createProjectFromImport({ sourcePath, plan }),
			).resolves.toEqual({ canceled: true });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("成功路径（任务式）：create 即刻返回引用，终态含统计与解构会话", async () => {
		const root = tmpRoot();
		try {
			const sourcePath = writeSampleTxt(root);
			const spawns: unknown[] = [];
			const { face, workspaceRoot } = buildFace(root, sourcePath, {
				spawner: {
					async spawn(opts) {
						spawns.push(opts);
						return { conversationId: "conv-1" };
					},
				},
			});
			const plan = await face.previewImport(sourcePath);
			const result = await face.createProjectFromImport({ sourcePath, plan });
			if (result.canceled) throw new Error("不应取消");
			// 任务式：立即返回引用（不带统计），终态经 createProgress 轮询
			expect(result.reference).toEqual({ referenceId: workspaceRoot, label: "proj" });
			const job = await waitTerminalJob(face);
			expect(job.phase).toBe("succeeded");
			expect(job.result?.conversationId).toBe("conv-1");
			expect(job.result?.stats.chapters).toBe(2);
			expect(spawns).toHaveLength(1);
			expect(spawns[0]).toMatchObject({ agentType: "ProjectImporter" });
			const meta = JSON.parse(readFileSync(importMetaPath(workspaceRoot), "utf8")) as {
				status: string;
			};
			expect(meta.status).toBe("analyzing");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("落库失败 → 后台链置 failed（error 可见）且 rollback（不留半截项目）", async () => {
		const root = tmpRoot();
		try {
			const sourcePath = writeSampleTxt(root);
			const { face, session } = buildFace(root, sourcePath);
			// 篡改计划使其与源不一致 → apply 抛错 → 后台链 rollback + job failed
			const plan = await face.previewImport(sourcePath);
			const broken = { ...plan, totalChars: plan.totalChars + 1 };
			const result = await face.createProjectFromImport({ sourcePath, plan: broken });
			if (result.canceled) throw new Error("不应取消");
			const job = await waitTerminalJob(face);
			expect(job.phase).toBe("failed");
			expect(job.error).toMatch(/不一致/);
			expect(session.calls).toContain("rollback");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("派生不可用：导入保留、状态置 failed（原因可见），终态带 spawnSkipped", async () => {
		const root = tmpRoot();
		try {
			const sourcePath = writeSampleTxt(root);
			const { face, workspaceRoot } = buildFace(root, sourcePath);
			const plan = await face.previewImport(sourcePath);
			const result = await face.createProjectFromImport({ sourcePath, plan });
			if (result.canceled) throw new Error("不应取消");
			const job = await waitTerminalJob(face);
			expect(job.phase).toBe("succeeded");
			expect(job.result?.spawnSkipped).toBeDefined();
			const meta = JSON.parse(readFileSync(importMetaPath(workspaceRoot), "utf8")) as {
				status: string;
				statusReason?: string;
			};
			expect(meta.status).toBe("failed");
			expect(meta.statusReason).toBeDefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("retry：置 analyzing 后派生新会话；无导入记录报错", async () => {
		const root = tmpRoot();
		try {
			const sourcePath = writeSampleTxt(root);
			let spawnCount = 0;
			const { face } = buildFace(root, sourcePath, {
				spawner: {
					async spawn() {
						spawnCount += 1;
						return { conversationId: `conv-${spawnCount}` };
					},
				},
			});
			const plan = await face.previewImport(sourcePath);
			const created = await face.createProjectFromImport({ sourcePath, plan });
			if (created.canceled) throw new Error("不应取消");
			// import.json 由后台链写入——重试前先等终态
			await waitTerminalJob(face);
			const retried = await face.retryImportAnalysis();
			expect(retried.conversationId).toBe("conv-2");
			await expect(
				createProjectImportFace({
					service: new ProjectImportService(),
					allowedSources: () => new Set(),
					workspaceRoot: () => join(root, "empty"),
					store: () => new InMemoryNovelStore(),
					spawner: () => ({ async spawn() { return { conversationId: "x" }; } }),
				}).retryImportAnalysis(),
			).rejects.toThrow(/导入记录/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("runner 路由：预览/落库走后台执行器（apply 传 dbPath），running 进度透出", async () => {
		const root = tmpRoot();
		try {
			const sourcePath = writeSampleTxt(root);
			const calls: string[] = [];
			let activeJobValue: ImportJobProgress | undefined = undefined;
			const runner: ProjectImportRunner = {
				async prepare(path) {
					calls.push(`prepare:${path}`);
					return new ProjectImportService().prepare(path);
				},
				async apply(input) {
					calls.push(`apply:${input.workspaceRoot}:${input.dbPath}`);
					// 模拟进行中进度（200ms 后完成落库）
					activeJobValue = { stage: "writing-db", done: 2, total: 5 };
					await new Promise((resolve) => setTimeout(resolve, 200));
					const stats = await new ProjectImportService().apply({
						workspaceRoot: input.workspaceRoot,
						store: new InMemoryNovelStore(),
						sourcePath: input.sourcePath,
						plan: input.plan,
					});
					activeJobValue = undefined;
					return stats;
				},
				activeJob: () => activeJobValue,
			};
			const { face, workspaceRoot } = buildFace(root, sourcePath, { runner });
			const plan = await face.previewImport(sourcePath);
			expect(calls[0]).toBe(`prepare:${sourcePath}`);
			const result = await face.createProjectFromImport({ sourcePath, plan });
			if (result.canceled) throw new Error("不应取消");
			// running 期间进度经 createProgress 透出（runner activeJob 实时合成）
			const running = await face.createProgress();
			expect(running?.phase).toBe("running");
			expect(calls[1]).toBe(`apply:${workspaceRoot}:${join(workspaceRoot, "novel.db")}`);
			const job = await waitTerminalJob(face);
			expect(job.phase).toBe("succeeded");
			expect(job.result?.stats.chapters).toBe(2);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("任务进行中重复 create 被拒绝", async () => {
		const root = tmpRoot();
		try {
			const sourcePath = writeSampleTxt(root);
			let release!: () => void;
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			const runner: ProjectImportRunner = {
				async prepare(path) {
					return new ProjectImportService().prepare(path);
				},
				async apply(input) {
					await gate;
					return new ProjectImportService().apply({
						workspaceRoot: input.workspaceRoot,
						store: new InMemoryNovelStore(),
						sourcePath: input.sourcePath,
						plan: input.plan,
					});
				},
				activeJob: () => undefined,
			};
			const { face } = buildFace(root, sourcePath, { runner });
			const plan = await face.previewImport(sourcePath);
			const first = await face.createProjectFromImport({ sourcePath, plan });
			if (first.canceled) throw new Error("不应取消");
			await expect(face.createProjectFromImport({ sourcePath, plan })).rejects.toThrow(
				/已有导入任务进行中/,
			);
			release();
			await waitTerminalJob(face);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
