/**
 * ProjectImportFace（GUI 项目导入门面组装）：把 ProjectImportService（确定性解析/落库）
 * + 宿主文件选择/白名单 + 全新工作区绑定（save 对话框建目录 → 绑库 → 提交/回滚）+
 * ProjectImporter 会话派生组装成 client 契约的 ProjectImportApi 形状。
 * 与 LibraryFace 平行；错误统一抛 ImportError（消息面向用户，经 RPCError.remote 透传）。
 */
import { basename } from "node:path";
import { PROJECT_IMPORTER_AGENT_TYPE } from "../runtime/agent/definitions/ProjectImporterAgentDefinition.js";
import type { NovelStore } from "../novel/store.js";
import type { ProjectImportApi } from "../client/NovelApiClient.js";
import { ProjectImportService } from "./ProjectImportService.js";
import type { ProjectImportRunner } from "./ImportProcessRunner.js";
import { ImportError } from "./ImportError.js";
import type {
	ImportJobStatus,
	ImportPlan,
	ImportStats,
	ProjectImportCreateResult,
} from "./ImportTypes.js";

/** 全新工作区会话（宿主绑定后注入；commit=登记最近列表，rollback=清库删目录） */
export interface FreshWorkspaceSession {
	/** 工作区根（= spawn 的 NOVEL_CONVERSATION_WORKSPACE / agent 文件沙盒） */
	readonly workspaceRoot: string;
	/** 已绑定的新项目 novel store（空库；导入写面） */
	readonly store: NovelStore;
	/** novel.db 文件路径（后台进程执行 apply 时子进程自开连接用） */
	readonly dbPath: string;
	/** 成功提交：登记最近项目列表（此后走常规打开编排） */
	commit(): Promise<void>;
	/** 失败回滚：关库 + 清当前工作区态 + 删除工作区目录与派生 storeDir */
	rollback(): Promise<void>;
}

/** 解构会话派生面（CMS spawnConversation 注入面；测试可注入桩） */
export interface ImportConversationSpawner {
	/**
	 * 派生 ProjectImporter 后台会话（task 载荷经 storedir/task.json + env 注入自动驱动）
	 * @param opts agentType + 任务载荷
	 * @returns 会话引用
	 */
	spawn(opts: { agentType: string; task?: unknown }): Promise<{ conversationId: string }>;
}

/** ProjectImportFace 组装依赖（宿主注入；getter 形态支持状态热取） */
export interface ProjectImportFaceDeps {
	/** 确定性导入服务（同步参照实现；无 runner 时直接在进程内执行） */
	service: ProjectImportService;
	/** 后台进程执行器（耗时操作不堵宿主事件循环；缺省 = 进程内同步执行） */
	runner?: () => ProjectImportRunner;
	/** 宿主原生文件选择（返回绝对路径并登记白名单）；缺省 = 文件选择不可用 */
	pickFile?: () => Promise<string | null>;
	/** 导入源路径白名单（pickFile 登记）；缺省 = 空（一切 sourcePath 拒绝） */
	allowedSources?: () => Set<string>;
	/** 新建工作区目录（save 型对话框 + 建目录 + 工作区白名单）；缺省 = 不可用 */
	createWorkspaceDir?: () => Promise<{ referenceId: string; label: string } | undefined>;
	/** 绑定全新工作区（locator + rebind；不含最近列表登记）；缺省 = 不可用 */
	bindFreshWorkspace?: (reference: { referenceId: string; label: string }) => Promise<FreshWorkspaceSession>;
	/** 解构会话派生面；缺省/返回 undefined = 解构不可用（降级：导入完成、状态置 failed 待重试） */
	spawner?: () => ImportConversationSpawner | undefined;
	/** 解构不可用的统一原因（provider 未配置等） */
	spawnUnavailableReason?: () => string;
	/** 解构会话 journal 路径（进度信号；缺省 = 无 journal 信号） */
	analysisJournalPath?: () => string | undefined;
	/** 当前工作区根（importProgress 定位 import.json；undefined = 无） */
	workspaceRoot: () => string | undefined;
	/** 当前工作区 novel store（进度 outline 信号；undefined = 无） */
	store: () => NovelStore | undefined;
}

/**
 * 组装 ProjectImportApi（novel-rpc projectImport 面）
 * @param deps 宿主依赖
 * @returns ProjectImportApi 实现
 */
export function createProjectImportFace(deps: ProjectImportFaceDeps): ProjectImportApi {
	/** 任务式创建状态（终态保留至下次创建，供轮询方取结果） */
	let job: ImportJobStatus | null = null;
	const assertAllowed = (sourcePath: string): void => {
		const allowed = deps.allowedSources?.() ?? new Set<string>();
		if (!allowed.has(sourcePath)) {
			throw new ImportError(
				"IMP_INVALID_ARGUMENT",
				"源文件路径未经宿主文件选择器授权（先经「选择文件」获取）",
			);
		}
	};
	/** 后台链：落库（后台进程/进程内）→ commit → 派生解构；终态写回 job */
	const runCreateJob = async (
		session: FreshWorkspaceSession,
		reference: { referenceId: string; label: string },
		input: { sourcePath: string; plan: ImportPlan },
	): Promise<void> => {
		let stats: ImportStats;
		try {
			const runner = deps.runner?.();
			stats =
				runner !== undefined
					? await runner.apply({
							workspaceRoot: session.workspaceRoot,
							dbPath: session.dbPath,
							sourcePath: input.sourcePath,
							plan: input.plan,
						})
					: await deps.service.apply({
							workspaceRoot: session.workspaceRoot,
							store: session.store,
							sourcePath: input.sourcePath,
							plan: input.plan,
						});
		} catch (err) {
			// 落库失败：整工作区回滚（关库删目录，不留半截项目）
			await session.rollback().catch(() => {});
			job = { phase: "failed", progress: null, error: errText(err) };
			return;
		}
		await session.commit();
		// 解构必跑：派生失败不回滚内容导入——状态置 failed（原因可见），打开项目后可重试
		const spawner = deps.spawner?.();
		if (spawner === undefined) {
			const reason = deps.spawnUnavailableReason?.() ?? "解构会话不可用";
			await deps.service
				.markStatus(session.workspaceRoot, { status: "failed", statusReason: reason })
				.catch(() => {});
			job = {
				phase: "succeeded",
				progress: null,
				result: { reference, stats, spawnSkipped: reason },
			};
			return;
		}
		try {
			const spawned = await spawner.spawn({
				agentType: PROJECT_IMPORTER_AGENT_TYPE,
				task: {
					sourceName: basename(input.sourcePath),
					chapters: stats.chapters,
					batches: stats.batches,
				},
			});
			job = {
				phase: "succeeded",
				progress: null,
				result: { reference, stats, conversationId: spawned.conversationId },
			};
		} catch (err) {
			const reason = errText(err);
			await deps.service
				.markStatus(session.workspaceRoot, { status: "failed", statusReason: reason })
				.catch(() => {});
			job = {
				phase: "succeeded",
				progress: null,
				result: { reference, stats, spawnSkipped: `解构会话派生失败：${reason}` },
			};
		}
	};
	return {
		async pickImportFile() {
			if (deps.pickFile === undefined) {
				throw new ImportError("IMP_INVALID_ARGUMENT", "宿主未提供文件选择能力");
			}
			const sourcePath = await deps.pickFile();
			return sourcePath === null ? null : { sourcePath };
		},
		async previewImport(sourcePath) {
			assertAllowed(sourcePath);
			// 耗时解析（zip 解压 + 大文本）优先走后台进程；无 runner 进程内执行
			const runner = deps.runner?.();
			return runner !== undefined
				? runner.prepare(sourcePath)
				: deps.service.prepare(sourcePath);
		},
		async createProjectFromImport(input: {
			sourcePath: string;
			plan: ImportPlan;
		}): Promise<ProjectImportCreateResult> {
			assertAllowed(input.sourcePath);
			if (job?.phase === "running") {
				throw new ImportError("IMP_INVALID_ARGUMENT", "已有导入任务进行中，请稍候");
			}
			if (deps.createWorkspaceDir === undefined || deps.bindFreshWorkspace === undefined) {
				throw new ImportError("IMP_INVALID_ARGUMENT", "宿主未提供项目创建能力");
			}
			const reference = await deps.createWorkspaceDir();
			if (reference === undefined) return { canceled: true };
			const session = await deps.bindFreshWorkspace(reference);
			// 任务式启动：RPC 即刻返回引用（kkrpc 默认 30s 请求超时容不下分钟级落库）；
			// 落库与解构派生在后台链执行，终态经 createProgress 轮询
			job = { phase: "running", progress: deps.runner?.().activeJob() ?? null };
			void runCreateJob(session, reference, input);
			return { canceled: false, reference };
		},
		async importProgress() {
			const root = deps.workspaceRoot();
			const store = deps.store();
			if (root === undefined || store === undefined) {
				return {
					status: "none" as const,
					totalBatches: 0,
					coveredBatches: 0,
					percent: 0,
					indeterminate: true,
					unitCount: 0,
				};
			}
			return deps.service.progress(root, store, deps.analysisJournalPath?.());
		},
		async createProgress() {
			if (job === null) return null;
			if (job.phase === "running") {
				// 进度实时合成（后台进程 activeJob 每次现取）
				return { ...job, progress: deps.runner?.().activeJob() ?? job.progress ?? null };
			}
			return job;
		},
		async retryImportAnalysis() {
			const root = deps.workspaceRoot();
			if (root === undefined) {
				throw new ImportError("IMP_INVALID_ARGUMENT", "需先打开项目");
			}
			const spawner = deps.spawner?.();
			if (spawner === undefined) {
				throw new ImportError(
					"IMP_INVALID_ARGUMENT",
					deps.spawnUnavailableReason?.() ?? "解构会话不可用",
				);
			}
			const meta = await deps.service.readMeta(root);
			if (meta === undefined) {
				throw new ImportError("IMP_NOT_FOUND", "该项目没有导入记录（import.json 缺失）");
			}
			await deps.service.markStatus(root, { status: "analyzing" });
			try {
				const spawned = await spawner.spawn({
					agentType: PROJECT_IMPORTER_AGENT_TYPE,
					task: {
						sourceName: meta.sourceName,
						chapters: meta.stats.chapters,
						batches: meta.stats.batches,
					},
				});
				return { conversationId: spawned.conversationId };
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				await deps.service
					.markStatus(root, { status: "failed", statusReason: reason })
					.catch(() => {});
				throw err;
			}
		},
	};
}

/** 错误 → 文本 */
function errText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
