/**
 * NovelApiClient：精简客户端门面（重建版）。
 * 把 ConversationManagerHandle（目录/生命周期）+ NovelHandle（查询/变更）包装成 UI 消费的
 * conversations / novel 两个子 API。错误已在 handle 层归一为 RPCError。
 */

import type { ConversationManagerHandle } from "../manager/ConversationManagerHandle.js";
import type { NovelHandle } from "../novel/client/NovelHandle.js";
import type { ConversationManagerServer } from "../conversation/server/ConversationManagerServer.js";
import type { NovelStore } from "../novel/store.js";
import type { ConversationRef, ConversationSummary } from "../manager/contract/types.js";
import type { ConversationHandle, ConversationId } from "../conversation/contract/index.js";
import type { OutputEvent, ProjectedEvent } from "../conversation/contract/events/index.js";
import type { ConversationJournalReadOnlyService } from "../conversation/contract/journal/index.js";
import { FileConversationJournalReadOnlyService } from "../conversation/persistence/FileConversationJournalReadOnlyService.js";
import { toRPCError } from "../rpc/call.js";
import { RPCError } from "../rpc/RPCError.js";
import { debugLog } from "../log/debug.js";
import type { ApprovalQueueItem, AskingQueueItem } from "../conversation/server/WaitRequestQueue.js";
import type {
	AskQuestionAnswer,
	ConversationApprovalDecision,
	ConversationMode,
} from "../conversation/contract/types/index.js";
import type { AgentType } from "../conversation/contract/types/index.js";
import type { NovelMutation } from "../novel/contract/mutation.js";
import type {
	NovelMutateResult,
	NovelOverview,
	PublicationSnapshot,
	StoryOutlineSnapshot,
	StoryUnitWithLeaf,
} from "../novel/contract/snapshot.js";
import type {
	Character,
	CharacterId,
	Location,
	LocationId,
	Paragraph,
	ParagraphId,
	StoryUnit,
	StoryUnitId,
} from "../novel/model/index.js";
// 书库类型 type-only 引入（LibraryService.ts 顶层 import node:fs——类型引用编译期擦除，
// 本文件保持 browser-safe，供 client 出口 re-export）
import type {
	AnalysisProgress,
	BookMeta,
	BookSummary,
	ImportBookResult,
	ParagraphManifestEntry,
} from "../library/LibraryService.js";

/** 会话子 API（目录 + 生命周期） */
export interface ConversationApi {
	/**
	 * 列出所有会话摘要
	 * @returns 会话摘要列表
	 */
	list(): Promise<ConversationSummary[]>;
	/**
	 * 新建会话（默认 novel agent）
	 * @param agentType agent 类型（缺省 novel）
	 * @returns 会话引用（含对端 handle）
	 */
	create(agentType?: AgentType): Promise<ConversationRef>;
	/**
	 * 打开（或恢复）会话
	 * @param conversationId 会话 id
	 * @returns 会话对端 handle
	 */
	open(conversationId: ConversationId): Promise<ConversationHandle>;
	/**
	 * 删除会话
	 * @param conversationId 会话 id
	 */
	delete(conversationId: ConversationId): Promise<void>;
	/**
	 * 重命名会话（持久化到会话存储，重启后恢复；显式名优先于 journal 首句派生）
	 * @param conversationId 会话 id
	 * @param name 新名字（trim 后非空）
	 * @returns 是否命中会话（false = 会话不存在或名字为空）
	 */
	rename(conversationId: ConversationId, name: string): Promise<boolean>;
	/**
	 * 置顶/取消置顶会话（持久化到会话存储，重启后恢复）
	 * @param conversationId 会话 id
	 * @param pinned 是否置顶
	 * @returns 是否命中会话（false = 会话不存在）
	 */
	pin(conversationId: ConversationId, pinned: boolean): Promise<boolean>;
	/**
	 * 读取会话已落盘历史（journal 沙盒子集 → OutputEvent 序列，无 delta）。
	 * renderer 无文件权限，经 Main 代读。
	 * @param conversationId 会话 id
	 * @param opts 可选分页（fromSeq / limit）
	 * @returns 已落盘事件序列（run-start/end 边界 + user/assistant.message + tool-call 事件）
	 */
	history(
		conversationId: ConversationId,
		opts?: { fromSeq?: number; limit?: number },
	): Promise<OutputEvent[]>;
	/**
	 * 投影读取历史（journal 完整事件 → 投影层 → ProjectedEvent 序列）。
	 * 与 hub 实时订阅同形态；工具调用以 tool-recorded.started/recorded 出现。
	 * renderer 无文件权限，经 Main 代读。见 PRD `output-投影层` §4.5。
	 * @param conversationId 会话 id
	 * @param opts 可选分页（fromSeq / limit，与 history 相同语义）
	 * @returns 投影事件序列
	 */
	projectedHistory(
		conversationId: ConversationId,
		opts?: { fromSeq?: number; limit?: number },
	): Promise<ProjectedEvent[]>;
	/**
	 * 查询会话当前生效模式（review/bypass/compose；mode.set 待下次 run 生效）。
	 * 读走查：经 manager 定位会话后调 handle.getConversationMode。
	 * @param conversationId 会话 id
	 * @returns 当前生效模式
	 */
	getMode(conversationId: ConversationId): Promise<ConversationMode>;
	/**
	 * 设置会话模式：经 manager 定位会话后以 control lane 下发 mode.set
	 * （记 pending + mode.pending 事件；下一次 provider call 发起时晋升 active，
	 * 权威回显以 mode.changed 事件为准）。
	 * @param conversationId 会话 id
	 * @param mode 目标模式（review/bypass/compose）
	 * @returns 控制回执（不入 journal）
	 */
	setMode(conversationId: ConversationId, mode: ConversationMode): Promise<{ seq: number; recordedAt: string }>;
}

/** 审批子 API（wait 队列：UI 拉取 + 决策；request/resolve 分离） */
export interface ApprovalApi {
	/**
	 * 待 UI 决策的审批列表（decisioner="ui"；含近期已决条目）
	 * @returns 队列条目（按提交时间倒序）
	 */
	list(): Promise<readonly ApprovalQueueItem[]>;
	/**
	 * 提交审批决策（CMS 记录并直推驻留 conversation；已退出则重启后经 takeDecisions 续跑）
	 * @param requestId 请求 id
	 * @param decision 决策（approve / reject / edit+意见）
	 * @returns 是否命中待决条目
	 */
	resolve(requestId: string, decision: ConversationApprovalDecision): Promise<boolean>;
}

/** 提问子 API（wait 队列：UI 拉取 + 作答；request/resolve 分离） */
export interface AskingApi {
	/**
	 * 待 UI 作答的提问列表（decisioner="ui"；含近期已答条目供卡片展示）
	 * @returns 队列条目（按提交时间倒序）
	 */
	list(): Promise<readonly AskingQueueItem[]>;
	/**
	 * 提交提问回答（CMS 记录并直推驻留 conversation；已退出则重启后按未回答回填）
	 * @param requestId 提问请求 id
	 * @param answers 逐问回答（skipped 表示作者跳过）
	 * @returns 是否命中待决条目
	 */
	resolve(requestId: string, answers: readonly AskQuestionAnswer[]): Promise<boolean>;
}

/** novel 查询子 API（按 op 包装 NovelHandle.query 的强类型面） */
export interface NovelContentApi {
	overview: {
		/** 小说总览 */
		get(): Promise<NovelOverview>;
	};
	outline: {
		/** 大纲（含 story unit 树；includePlans=true 附 leaf 计划与叶完成度 rollup） */
		get(options?: { includePlans?: boolean }): Promise<StoryOutlineSnapshot>;
		/** 单个 story unit（includePlans=true 附 leaf 计划与 progress） */
		getStoryUnit(id: StoryUnitId, options?: { includePlans?: boolean }): Promise<StoryUnit>;
	};
	characters: {
		/** 角色列表 */
		list(): Promise<Character[]>;
		/** 单个角色 */
		get(id: CharacterId): Promise<Character>;
	};
	locations: {
		/** 地点列表 */
		list(): Promise<Location[]>;
		/** 单个地点 */
		get(id: LocationId): Promise<Location>;
	};
	paragraphs: {
		/** 段落列表（传 storyUnitId 按单元过滤；缺省全量——按单元分组、组内按 orderKey） */
		list(storyUnitId?: StoryUnitId): Promise<Paragraph[]>;
		/** 单个段落 */
		get(id: ParagraphId): Promise<Paragraph>;
	};
	publication: {
		/** 发布结构（卷/章） */
		get(): Promise<PublicationSnapshot>;
	};
	/**
	 * 变更（乐观锁；stale 抛 NovelStaleRevisionError → RPCError）
	 * @param m 变更
	 * @returns 变更结果
	 */
	mutate(m: NovelMutation): Promise<NovelMutateResult>;
	/**
	 * 批量变更（批内原子）：单事务顺序执行，任一项失败整批回滚并抛错
	 * @param ms 变更序列
	 * @returns 逐项变更结果（与 ms 等长同序）
	 */
	mutateBatch(ms: readonly NovelMutation[]): Promise<NovelMutateResult[]>;
}

/** 分段批（manifest 条目 + 正文文本） */
export type ParagraphTextBatch = ParagraphManifestEntry & { text: string };

/** 解析会话派生结果 */
export interface LibrarySpawnResult {
	/** 解析会话 id（派生成功时） */
	conversationId?: string;
	/** 未派生的原因（降级仅导入等） */
	spawnSkipped?: string;
}

/** 导入结果（含解析会话派生） */
export interface LibraryImportResult extends ImportBookResult, LibrarySpawnResult {}

/** 书库大纲快照（outline.get + includePlans：units 附 leaf 绑定） */
export interface LibraryOutlineSnapshot {
	readonly outline: StoryOutlineSnapshot["outline"];
	readonly units: readonly StoryUnitWithLeaf[];
}

/**
 * 书库子 API（完本解构：读面 + 导入写面）。
 * 形状对齐 core/src/library/LibraryService；宿主（Electron main）经
 * createLibraryFace 组装注入，renderer 经 novel-rpc 直连。未装配时各方法
 * 抛 invalid-request「书库服务未装配」（对齐 LibraryRead 工具降级模式）。
 */
export interface LibraryApi {
	/** 书单（经工作区 allowlist 过滤；导入时间序） */
	listBooks(): Promise<BookSummary[]>;
	/** 书元数据（含 status / statusReason / stats；进度轮询读面） */
	readMeta(bookId: string): Promise<BookMeta>;
	/** 分段索引（manifest：全书有序） */
	readManifest(bookId: string): Promise<ParagraphManifestEntry[]>;
	/** 分段正文（按章或按 id；条数护栏单次默认 6、上限 24） */
	readParagraphs(
		bookId: string,
		query: { ids?: readonly string[]; chapterNo?: number; offset?: number; limit?: number },
	): Promise<{ items: ParagraphTextBatch[]; total: number }>;
	/** 分析产物（style.md / excerpts.md；长度护栏截断） */
	readAnalysis(
		bookId: string,
		which: "style" | "excerpt",
		maxChars?: number,
	): Promise<{ content: string; truncated: boolean }>;
	/** 解析进度（outline 覆盖推导；GUI 3s 轮询读面） */
	analysisProgress(bookId: string): Promise<AnalysisProgress>;
	/** 每书 book.db 只读直开代读：幕级大纲（includePlans——附 leaf 人物/地点绑定） */
	bookOutline(bookId: string): Promise<LibraryOutlineSnapshot>;
	/** 每书 book.db 只读直开代读：人物 */
	bookCharacters(bookId: string): Promise<Character[]>;
	/** 每书 book.db 只读直开代读：地点 */
	bookLocations(bookId: string): Promise<Location[]>;
	/** 每书 book.db 只读直开代读：卷章发布骨架 */
	bookPublication(bookId: string): Promise<PublicationSnapshot>;
	/** 选择源文件（宿主原生对话框 + 路径白名单登记；取消返回 null） */
	pickBookFile(): Promise<{ sourcePath: string } | null>;
	/** 导入（确定性解析；可选拉起 BookAnalyst 解析会话；成功自动授权当前工作区书单） */
	importBook(input: { sourcePath: string; title?: string; spawnAnalysis?: boolean }): Promise<LibraryImportResult>;
	/** 重试解析（复用确定性产物，置解析中后派生新会话） */
	retryAnalysis(bookId: string): Promise<LibrarySpawnResult>;
}

/** 客户端门面：conversations + novel + approvals + askings + library 五域 */
export interface NovelApiClient {
	readonly conversations: ConversationApi;
	readonly novel: NovelContentApi;
	readonly approvals: ApprovalApi;
	readonly askings: AskingApi;
	readonly library: LibraryApi;
}

/** 门面构造依赖（注入两域 handle） */
export interface NovelApiClientOptions {
	/** manager 客户端（目录 / 生命周期） */
	manager: ConversationManagerHandle;
	/** novel 客户端（查询 / 变更） */
	novel: NovelHandle;
	/**
	 * history 查询注入（内存测试/特殊装配用；renderer 经 wrap 不经此构造）。
	 * 缺省返回空序列（纯实时流）。
	 */
	history?: (
		conversationId: ConversationId,
		opts?: { fromSeq?: number; limit?: number },
	) => Promise<OutputEvent[]>;
	/**
	 * projectedHistory 查询注入（同 history 的内存测试/特殊装配面）。
	 * 缺省回退 history（投影形态由调用方决定时可用）。
	 */
	projectedHistory?: (
		conversationId: ConversationId,
		opts?: { fromSeq?: number; limit?: number },
	) => Promise<ProjectedEvent[]>;
	/** 书库面注入（内存测试用；renderer 经 wrap 不经此构造） */
	library?: LibraryApi;
}

/** 书库未装配降级实现（各方法抛 invalid-request；对齐 LibraryRead 工具降级模式） */
function createUnavailableLibrary(): LibraryApi {
	const unavailable = (method: string): Promise<never> =>
		Promise.reject(new RPCError({ code: "invalid-request" }, `书库服务未装配（library.${method} 不可用）`));
	return {
		listBooks: () => unavailable("listBooks"),
		readMeta: () => unavailable("readMeta"),
		readManifest: () => unavailable("readManifest"),
		readParagraphs: () => unavailable("readParagraphs"),
		readAnalysis: () => unavailable("readAnalysis"),
		analysisProgress: () => unavailable("analysisProgress"),
		bookOutline: () => unavailable("bookOutline"),
		bookCharacters: () => unavailable("bookCharacters"),
		bookLocations: () => unavailable("bookLocations"),
		bookPublication: () => unavailable("bookPublication"),
		pickBookFile: () => unavailable("pickBookFile"),
		importBook: () => unavailable("importBook"),
		retryAnalysis: () => unavailable("retryAnalysis"),
	};
}

/**
 * 创建客户端门面
 * @param options manager + novel handle + 可选 history 注入
 * @returns NovelApiClient
 */
export function createNovelApiClient(options: NovelApiClientOptions): NovelApiClient {
	const { manager, novel, history, projectedHistory, library } = options;
	return {
		conversations: {
			list: () => manager.list(),
			create: (agentType = "novel") => manager.spawnConversation({ agentType }),
			open: async (conversationId) => (await manager.createOrResume(conversationId)).handle,
			delete: (conversationId) => manager.delete(conversationId),
			rename: (conversationId, name) => manager.rename(conversationId, name),
			pin: (conversationId, pinned) => manager.setPinned(conversationId, pinned),
			history: (conversationId, opts) =>
				history !== undefined ? history(conversationId, opts) : Promise.resolve([]),
			projectedHistory: (conversationId, opts) =>
				projectedHistory !== undefined
					? projectedHistory(conversationId, opts)
					: Promise.resolve([]),
			getMode: async (conversationId) => {
				const handle = (await manager.createOrResume(conversationId)).handle;
				return handle.getConversationMode();
			},
			setMode: async (conversationId, mode) => {
				const handle = (await manager.createOrResume(conversationId)).handle;
				return handle.sendSystemControl({ type: "mode.set", mode });
			},
		},
		// 客户端构造不经 manager 的 wait 队列（renderer 经 wrap 直连服务端门面）——占位
		approvals: {
			list: () => Promise.resolve([]),
			resolve: async () => false,
		},
		askings: {
			list: () => Promise.resolve([]),
			resolve: async () => false,
		},
		novel: {
			overview: {
				get: () => novel.query<NovelOverview>({ op: "overview.get" }),
			},
			outline: {
				get: (options?: { includePlans?: boolean }) =>
					novel.query<StoryOutlineSnapshot>({ op: "outline.get", includePlans: options?.includePlans }),
				getStoryUnit: (id: StoryUnitId, options?: { includePlans?: boolean }) =>
					novel.query<StoryUnit>({ op: "outline.storyUnit.get", storyUnitId: id, includePlans: options?.includePlans }),
			},
			characters: {
				list: () => novel.query<Character[]>({ op: "characters.list" }),
				get: (id) => novel.query<Character>({ op: "characters.get", characterId: id }),
			},
			locations: {
				list: () => novel.query<Location[]>({ op: "locations.list" }),
				get: (id) => novel.query<Location>({ op: "locations.get", locationId: id }),
			},
			paragraphs: {
				list: (storyUnitId) =>
					novel.query<Paragraph[]>({ op: "paragraphs.list", storyUnitId }),
				get: (id) => novel.query<Paragraph>({ op: "paragraph.get", paragraphId: id }),
			},
			publication: {
				get: () => novel.query<PublicationSnapshot>({ op: "publication.get" }),
			},
			mutate: (m) => novel.mutate(m),
			mutateBatch: (ms) => novel.mutateBatch(ms),
		},
		// 书库面：宿主装配注入；缺省 = 未装配降级（browser/内存测试）
		library: library ?? createUnavailableLibrary(),
	};
}

/** 服务端门面构造依赖（expose 侧：manager 服务端 + novel 存储） */
export interface NovelApiServerOptions {
	/** manager 服务端（目录 / 生命周期） */
	manager: ConversationManagerServer;
	/** novel 存储（query / mutate） */
	novel: NovelStore;
	/**
	 * proxy 函数注入（kkrpc/remote-refs 的 ESM/CJS 双构建各有独立 WeakSet，
	 * 须由 expose 侧同一构建注入，才能把返回的 handle 注册为 remote ref）
	 */
	proxy?: <T extends object>(value: T) => T;
	/**
	 * journal 根目录（conversation 存储根，`<dir>/<conversationId>/journal.jsonl`）。
	 * 提供时 conversations.history 由 Main 侧代读实现；缺省返回空序列。
	 * 字符串形态构造期固定；函数形态每次调用现取（宿主 workspace 热切换重绑目录）。
	 */
	journalDir?: string | (() => string | undefined);
	/**
	 * 书库面（宿主经 createLibraryFace 组装注入：读面 + 导入 + 文件选择白名单）。
	 * 缺省 = 未装配降级（各方法抛 invalid-request「书库服务未装配」）。
	 */
	library?: LibraryApi;
}

/**
 * 把对端 handle 适配为可跨 remote-refs 的对象形态。
 * plain kkrpc wrap 的代理以函数为目标（typeof === "function"），remote-refs 按其 typeof
 * 编码为 function-kind ref，解码侧只可调用、无属性转发（handle.method 访问丢失）。
 * 函数型 handle 在此包装成普通对象（typeof "object" → object-kind ref，属性/方法可转发）。
 * @param handle 对端 handle（内存类实例 / kkrpc wrap 代理）
 * @returns 可标记的对象形态 handle
 */
function toRemoteHandle(handle: ConversationHandle): ConversationHandle {
	// typeof 窄化需经 unknown（ConversationHandle 无函数签名，直接判断会窄化成 never）
	const maybeCallable = handle as unknown;
	if (typeof maybeCallable !== "function") return handle;
	const remote = maybeCallable as unknown as ConversationHandle;
	return {
		sendUserMessage: (m) => remote.sendUserMessage(m),
		sendUserCommand: (c) => remote.sendUserCommand(c),
		sendSystemControl: (c) => remote.sendSystemControl(c),
		sendApprovalRequest: (r) => remote.sendApprovalRequest(r),
		sendAskingQuestionRequest: (r) => remote.sendAskingQuestionRequest(r),
		sendExitComposeRequest: (r) => remote.sendExitComposeRequest(r),
		subscribeEvents: (l) => {
			debugLog("[facade] subscribeEvents listener type:", typeof l, String(l).slice(0, 80));
			return remote.subscribeEvents(l);
		},
		resolveApproval: (id, d) => remote.resolveApproval(id, d),
		resolveQuestion: (id, a) => remote.resolveQuestion(id, a),
		resolveExitCompose: (id) => remote.resolveExitCompose(id),
		getConversationMode: () => remote.getConversationMode(),
		dispose: () => remote.dispose(),
	};
}

/**
 * 创建服务端门面（expose 侧，与 createNovelApiClient 对称）。
 * 供宿主进程（Electron main / novel-db 守护）直接 expose 给 UI。
 * @param options manager 服务端 + novel 存储
 * @returns NovelApiClient 形状的服务端实现
 */
export function createNovelApiServer(options: NovelApiServerOptions): NovelApiClient {
	const { manager, novel } = options;
	const mark = options.proxy ?? (<T extends object>(value: T): T => value);
	// history 代读（renderer 无文件权限，Main 侧读 journal 沙盒）：
	// 字符串形态构造期固定单例；函数形态（workspace 热切换）每次现取目录、
	// 按调用实例化（服务无状态，无副作用）
	const fixedReadOnly: ConversationJournalReadOnlyService | undefined =
		typeof options.journalDir === "string"
			? new FileConversationJournalReadOnlyService({ journalDir: options.journalDir })
			: undefined;
	const readOnly = (): ConversationJournalReadOnlyService | undefined => {
		if (fixedReadOnly !== undefined) return fixedReadOnly;
		const dir = typeof options.journalDir === "function" ? options.journalDir() : undefined;
		return dir !== undefined ? new FileConversationJournalReadOnlyService({ journalDir: dir }) : undefined;
	};
	return {
		conversations: {
			list: () => manager.list(),
			// handle 经注入的 proxy 注册 remote ref：Electron IPC 结构化克隆无法序列化类实例
			create: async (agentType = "novel") => {
				const ref = await manager.spawnConversation({ agentType });
				return { conversationId: ref.conversationId, handle: mark(toRemoteHandle(ref.handle)) };
			},
			open: async (conversationId) =>
				mark(toRemoteHandle((await manager.createOrResume(conversationId)).handle)),
			delete: (conversationId) => manager.delete(conversationId),
			rename: (conversationId, name) => manager.rename(conversationId, name),
			pin: (conversationId, pinned) => manager.setPinned(conversationId, pinned),
			history: (conversationId, opts) => {
				const service = readOnly();
				return service !== undefined ? service.history(conversationId, opts ?? {}) : Promise.resolve([]);
			},
			projectedHistory: (conversationId, opts) => {
				const service = readOnly();
				return service !== undefined
					? service.projectedHistory(conversationId, opts ?? {})
					: Promise.resolve([]);
			},
			getMode: async (conversationId) => {
				const handle = (await manager.createOrResume(conversationId)).handle;
				return handle.getConversationMode();
			},
			setMode: async (conversationId, mode) => {
				const handle = (await manager.createOrResume(conversationId)).handle;
				return handle.sendSystemControl({ type: "mode.set", mode });
			},
		},
		// wait 队列唯一权威在 CMS：UI 拉取 + 决策/作答（request/resolve 分离）
		approvals: {
			list: () => manager.listApprovals(),
			resolve: (requestId, decision) => manager.resolveApproval(requestId, decision),
		},
		askings: {
			list: () => manager.listAskings(),
			resolve: (requestId, answers) => manager.resolveAsking(requestId, answers),
		},
		novel: {
			overview: {
				get: () => novel.query({ op: "overview.get" }) as Promise<NovelOverview>,
			},
			outline: {
				get: (options?: { includePlans?: boolean }) =>
					novel.query({ op: "outline.get", includePlans: options?.includePlans }) as Promise<StoryOutlineSnapshot>,
				getStoryUnit: (id: StoryUnitId, options?: { includePlans?: boolean }) =>
					novel.query({ op: "outline.storyUnit.get", storyUnitId: id, includePlans: options?.includePlans }) as Promise<StoryUnit>,
			},
			characters: {
				list: () => novel.query({ op: "characters.list" }) as Promise<Character[]>,
				get: (id) =>
					novel.query({ op: "characters.get", characterId: id }) as Promise<Character>,
			},
			locations: {
				list: () => novel.query({ op: "locations.list" }) as Promise<Location[]>,
				get: (id) =>
					novel.query({ op: "locations.get", locationId: id }) as Promise<Location>,
			},
			paragraphs: {
				list: (storyUnitId) =>
					novel.query({ op: "paragraphs.list", storyUnitId }) as Promise<Paragraph[]>,
				get: (id) =>
					novel.query({ op: "paragraph.get", paragraphId: id }) as Promise<Paragraph>,
			},
			publication: {
				get: () => novel.query({ op: "publication.get" }) as Promise<PublicationSnapshot>,
			},
			// stale 归一：乐观锁冲突经 toRPCError 映射 code:"stale"（renderer 结构判断，跨模块 instanceof 不成立）
			mutate: async (m) => {
				try {
					return await novel.mutate(m);
				} catch (err) {
					throw toRPCError(err, "novel-db");
				}
			},
			mutateBatch: async (ms) => {
				try {
					return await novel.mutateBatch(ms);
				} catch (err) {
					throw toRPCError(err, "novel-db");
				}
			},
		},
		// 书库面：宿主注入的 LibraryApi 直挂 + LIB_* 业务错误归一（LibraryError.code →
		// lib-* RPCError code；renderer 按 code 分支提示）；未装配 = 降级实现
		library: wrapLibraryWithErrorNormalize(options.library),
	};
}

/** 书库面包装：逐方法归一错误（保持方法集合与实现一一对应） */
function wrapLibraryWithErrorNormalize(impl: LibraryApi | undefined): LibraryApi {
	const face = impl ?? createUnavailableLibrary();
	const wrap = async <T>(run: () => Promise<T>): Promise<T> => {
		try {
			return await run();
		} catch (err) {
			if (err instanceof RPCError) throw err;
			throw toRPCError(err, "library");
		}
	};
	return {
		listBooks: () => wrap(face.listBooks),
		readMeta: (bookId) => wrap(() => face.readMeta(bookId)),
		readManifest: (bookId) => wrap(() => face.readManifest(bookId)),
		readParagraphs: (bookId, query) => wrap(() => face.readParagraphs(bookId, query)),
		readAnalysis: (bookId, which, maxChars) => wrap(() => face.readAnalysis(bookId, which, maxChars)),
		analysisProgress: (bookId) => wrap(() => face.analysisProgress(bookId)),
		bookOutline: (bookId) => wrap(() => face.bookOutline(bookId)),
		bookCharacters: (bookId) => wrap(() => face.bookCharacters(bookId)),
		bookLocations: (bookId) => wrap(() => face.bookLocations(bookId)),
		bookPublication: (bookId) => wrap(() => face.bookPublication(bookId)),
		pickBookFile: () => wrap(face.pickBookFile),
		importBook: (input) => wrap(() => face.importBook(input)),
		retryAnalysis: (bookId) => wrap(() => face.retryAnalysis(bookId)),
	};
}
