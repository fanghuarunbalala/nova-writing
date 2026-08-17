/**
 * BookImportService（PRD library-完本解构 F1）：导入编排 = LibraryService 写侧
 * （确定性解析落库/落盘）+ spawn BookAnalyst 后台会话（任务载荷驱动自动解析）。
 * 调用方只见 import 领域操作；存储细节封装于 LibraryService（F9）。
 */
import { LibraryService, type ImportBookResult } from "./LibraryService.js";
import { BOOK_ANALYST_AGENT_TYPE } from "../runtime/agent/BookAnalystAgent.js";

/** 会话派生面（CMS spawnConversation 注入面；测试/冒烟可注入直构 spawner） */
export interface AnalystConversationSpawner {
	/**
	 * 派生后台会话（task 载荷经 storedir/task.json + NOVEL_ANALYST_TASK 注入）
	 * @param opts agentType + 任务载荷 + 附加 env
	 * @returns 会话引用（conversationId）
	 */
	spawn(opts: {
		agentType: string;
		task?: unknown;
		extraEnv?: Record<string, string>;
	}): Promise<{ conversationId: string }>;
}

/** BookImportService 构造选项 */
export interface BookImportServiceOptions {
	/** 书库服务（写侧门面） */
	service: LibraryService;
	/** 会话派生面（缺省 = 只导入不解析——确定性产物先行，解析另行触发） */
	spawner?: AnalystConversationSpawner;
	/** 书库根（NOVEL_LIBRARY_ROOT 注入子进程） */
	libraryRoot: string;
}

/** 导入结果（含解析会话） */
export interface ImportAndAnalyzeResult extends ImportBookResult {
	/** 解析会话 id（未触发解析时缺省） */
	conversationId?: string;
}

/**
 * 书籍导入编排服务
 */
export class BookImportService {
	/** 书库服务 */
	private readonly service: LibraryService;
	/** 会话派生面 */
	private readonly spawner?: AnalystConversationSpawner;
	/** 书库根 */
	private readonly libraryRoot: string;

	/**
	 * @param options 服务 + 派生面 + 书库根
	 */
	constructor(options: BookImportServiceOptions) {
		this.service = options.service;
		this.spawner = options.spawner;
		this.libraryRoot = options.libraryRoot;
	}

	/**
	 * 导入并（可选）触发后台解析
	 * @param input 源文件 + 可选书名；spawnAnalysis=false 只导入不解析
	 * @returns bookId + 统计 +（触发时）解析会话 id
	 */
	async importBook(input: {
		sourcePath: string;
		title?: string;
		spawnAnalysis?: boolean;
	}): Promise<ImportAndAnalyzeResult> {
		const result = await this.service.importBook({
			sourcePath: input.sourcePath,
			...(input.title !== undefined ? { title: input.title } : {}),
		});
		if (this.spawner === undefined || input.spawnAnalysis === false) {
			return result;
		}
		try {
			const spawned = await this.spawner.spawn({
				agentType: BOOK_ANALYST_AGENT_TYPE,
				task: {
					bookId: result.bookId,
					...(input.title !== undefined ? { title: input.title } : {}),
				},
				extraEnv: { NOVEL_LIBRARY_ROOT: this.libraryRoot },
			});
			return { ...result, conversationId: spawned.conversationId };
		} catch (err) {
			// spawn 失败（报到超时等）：书本置解析失败、目录保留供重试
			const reason = err instanceof Error ? err.message : String(err);
			await this.service
				.updateBookMeta(result.bookId, {
					status: "解析失败",
					...(reason.length > 0 ? { statusReason: reason.slice(0, 500) } : {}),
				})
				.catch(() => {});
			throw err;
		}
	}
}
