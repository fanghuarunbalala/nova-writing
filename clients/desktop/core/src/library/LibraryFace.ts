/**
 * LibraryFace（GUI 读/导入门面组装，PRD library-完本解构 F9 的宿主装配侧）：
 * 把 LibraryService（读面 + 导入写面）+ BookImportService（解析会话派生）+ 宿主
 * 文件选择/路径白名单组装成 client 契约的 LibraryApi 形状，供 novel-rpc expose。
 * 错误统一抛 LibraryError（经 toRPCError 映射 LIB_* 业务码）。
 */
import { LibraryError, LibraryService } from "./LibraryService.js";
import type { BookImportService } from "./BookImportService.js";
import { addBookToLibraryAllowlist } from "./LibraryAccessPolicy.js";
import type { LibraryApi, LibraryImportResult, LibraryOutlineSnapshot, ParagraphTextBatch } from "../client/NovelApiClient.js";
import type { PublicationSnapshot } from "../novel/contract/snapshot.js";
import type { Character, Location } from "../novel/model/index.js";

/** LibraryFace 组装依赖（宿主注入；getter 形态支持 workspace 热重绑） */
export interface LibraryFaceDeps {
	/** 书库服务（读面 + 导入写面；热重绑后取新实例） */
	service: () => LibraryService;
	/** 当前工作区根（书单授权目标；undefined = 无工作区，导入不授权） */
	workspaceRoot: () => string | undefined;
	/** 导入编排（含解析会话派生）；缺省/返回 undefined = 仅导入 */
	importer?: () => BookImportService | undefined;
	/** 宿主原生文件选择（返回绝对路径并登记白名单）；缺省 = 文件选择不可用 */
	pickFile?: () => Promise<string | null>;
	/** 导入源路径白名单（pickFile 登记）；缺省 = 空（一切 sourcePath 拒绝导入） */
	allowedSources?: () => Set<string>;
	/** 解析会话 journal 路径（bookId → journal.jsonl；缺省 = 无 journal 进度信号）。
	 *   宿主（GUI）在 spawn 时记录 bookId→conversationId 后据此定位 storedir */
	analysisJournalPath?: (bookId: string) => string | undefined;
}

/** 解析会话不可用的统一降级原因 */
const SPAWN_UNAVAILABLE = "解析会话不可用（需打开工作区并配置模型 provider）";

/**
 * 组装 LibraryApi（novel-rpc library 面）
 * @param deps 宿主依赖
 * @returns LibraryApi 实现
 */
export function createLibraryFace(deps: LibraryFaceDeps): LibraryApi {
	const queryBook = async <T>(bookId: string, q: unknown): Promise<T> => {
		const store = await deps.service().openBookStore(bookId, { readOnly: true });
		return (await store.query(q as never)) as T;
	};
	return {
		async listBooks() {
			return deps.service().listBooks();
		},
		async readMeta(bookId) {
			return deps.service().readBookMeta(bookId);
		},
		async readManifest(bookId) {
			return deps.service().readManifest(bookId);
		},
		async readParagraphs(bookId, query) {
			return deps.service().readParagraphs(bookId, query) as Promise<{
				items: ParagraphTextBatch[];
				total: number;
			}>;
		},
		async readAnalysis(bookId, which, maxChars) {
			return deps.service().readAnalysis(bookId, which, maxChars);
		},
		async analysisProgress(bookId) {
			const journalPath = deps.analysisJournalPath?.(bookId);
			return deps.service().analysisProgress(bookId, journalPath);
		},
		async bookOutline(bookId) {
			return queryBook<LibraryOutlineSnapshot>(bookId, { op: "outline.get", includePlans: true });
		},
		async bookCharacters(bookId) {
			return queryBook<Character[]>(bookId, { op: "characters.list" });
		},
		async bookLocations(bookId) {
			return queryBook<Location[]>(bookId, { op: "locations.list" });
		},
		async bookPublication(bookId) {
			return queryBook<PublicationSnapshot>(bookId, { op: "publication.get" });
		},
		async pickBookFile() {
			if (deps.pickFile === undefined) {
				throw new LibraryError("LIB_INVALID_ARGUMENT", "宿主未提供文件选择能力");
			}
			const sourcePath = await deps.pickFile();
			return sourcePath === null ? null : { sourcePath };
		},
		async importBook(input): Promise<LibraryImportResult> {
			const allowed = deps.allowedSources?.() ?? new Set<string>();
			if (!allowed.has(input.sourcePath)) {
				throw new LibraryError(
					"LIB_INVALID_ARGUMENT",
					"源文件路径未经宿主文件选择器授权（先经「选择文件」获取）",
				);
			}
		// 导入（确定性解析）→ 授权先行（spawn 失败的书也要在书单可见、可重试）
		const base = await deps.service().importBook({
			sourcePath: input.sourcePath,
			...(input.title !== undefined ? { title: input.title } : {}),
		});
		const workspaceRoot = deps.workspaceRoot();
		if (workspaceRoot !== undefined) {
			await addBookToLibraryAllowlist(workspaceRoot, base.bookId);
		}
		// 解析会话派生（可选）：不可用/未请求 → 置「未解析」（确定性产物就绪，可随时开始解析）；
		// 派生本身后台化——不阻塞导入 RPC（子进程报到秒级、最坏 15s，失败由 startAnalysis 回写解析失败）
		const result: LibraryImportResult = { ...base };
		const importer = deps.importer?.();
		if (input.spawnAnalysis === false || importer === undefined) {
			result.spawnSkipped =
				input.spawnAnalysis === false ? "仅导入（未请求解析会话）" : SPAWN_UNAVAILABLE;
			await deps
				.service()
				.updateBookMeta(base.bookId, { status: "未解析" })
				.catch(() => {});
		} else {
			// 后台派生：conversationId 不随导入返回（子进程报到异步）；进度/完成经状态轮询可见
			void importer.startAnalysis(base.bookId, input.title).catch(() => {
				/* startAnalysis 已回写解析失败（statusReason）；后台失败经状态轮询可见 */
			});
		}
		return result;
	},
		async retryAnalysis(bookId) {
			const importer = deps.importer?.();
			if (importer === undefined) {
				throw new LibraryError("LIB_INVALID_ARGUMENT", SPAWN_UNAVAILABLE);
			}
			// 复用既有确定性产物：置解析中 + 派生新会话（spawn 失败由 importer 回写失败态）
			await deps.service().readBookMeta(bookId);
			return importer.retryAnalysis(bookId);
		},
	};
}

