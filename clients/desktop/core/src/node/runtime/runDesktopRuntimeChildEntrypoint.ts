/**
 * runDesktopRuntimeChildEntrypoint：conversation 子进程入口。
 * 从 env 读 provider/manager WS/novel WS 配置，组装 Conversation：
 * - conversation ↔ CMS 全量 rpc 走 manager WS（单连接双工 RPCChannel：expose conversation
 *   + getAPI 调 CMS 面）；stdio 仅 stderr 日志（fd>2 管道禁用，见 CLAUDE.md）
 * - novel-db 走 kkrpc/ws（无 URL 时回退进程内内存 store，开发用）
 * - wait 请求无阻塞：经 managerWait 提交 CMS 队列；决策经 resolveApproval 回传
 *   （驻留直推）；120s 超时 → process.exit（CMS 决策后重启续跑）
 * - 重启恢复：journal 重放 + CMS takeDecisions 查询待决 → 暂停点续跑（resumePendingRun）
 * - subagent：SubagentRuntime 进程内编排（main 经 Agent/TaskOutput/TaskStop 派发）
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { join } from "node:path";
import { RPCChannel } from "kkrpc";
import { webSocketClientTransport } from "kkrpc/ws";
import { Conversation, type ConversationEventPublisher, type ManagerWaitChannel } from "../../conversation/server/Conversation.js";
import { EventPublisher } from "../../event/EventPublisher.js";
import { conversationEventsAddr } from "../../event/topics.js";
import { FileConversationJournalService } from "../../conversation/persistence/FileConversationJournalService.js";
import { HttpConversationJournalService } from "../../conversation/persistence/HttpConversationJournalService.js";
import { FileConversationJournalReadOnlyService } from "../../conversation/persistence/FileConversationJournalReadOnlyService.js";
import { FileConversationStateJournalService } from "../../conversation/persistence/FileConversationStateJournalService.js";
import { journalListener } from "../../conversation/JournalBridge.js";
import { debugLog } from "../../log/debug.js";
import { createLogger } from "../../log/pino.js";
import type { Logger } from "../../log/Logger.js";
import { SubagentRuntime } from "../../conversation/server/SubagentRuntime.js";
import { InMemoryNovelStore } from "../../novel/InMemoryNovelStore.js";
import { NovelHandle } from "../../novel/client/NovelHandle.js";
import { createProvider, type Provider } from "../../runtime/provider/Provider.js";
import { buildNovelAgent } from "../../runtime/agent/NovelAgent.js";
import { ProviderCallDebugger } from "../../runtime/debug/ProviderCallDebugger.js";
import {
  readNovelGlobalConstraintsSafe,
  NOVEL_GLOBAL_CONSTRAINTS_FILE_NAME,
} from "../workspace/readNovelGlobalConstraints.js";
import {
	AGENT_CASES_DIR,
	readAgentCaseContent,
	scanAgentCases,
	seedAgentCasesIfNeeded,
} from "../workspace/agentCases.js";
import { LlmIntentClassifier } from "../../runtime/agent/composeGuide/LlmIntentClassifier.js";
import { selectGuideCases } from "../../runtime/agent/composeGuide/selectGuideCases.js";
import { wrapNovelGuideMessage } from "../../runtime/agent/composeGuide/novelGuideMessage.js";
import {
  ComposeModeService,
  ComposeModeStateProvider,
} from "../../conversation/compose/index.js";
import { InMemoryConversationTodoStore } from "../../runtime/todo/InMemoryConversationTodoStore.js";
import type { LLMessage, SamplingConfig, ThinkingLevel } from "../../runtime/provider/types.js";
import type { AgentRunConfig } from "../../runtime/loop/types.js";
import { ModelInfoRegistry } from "../../runtime/provider/model-info.js";
import {
	parseRuntimeSettingsEnv,
	type ResolvedAgentConnection,
} from "../../config/runtimeSettings.js";
import { SkillRegistry } from "../../runtime/skill/SkillRegistry.js";
import {
	SKILLS_SETTINGS_ENV,
	parseSkillsEnv,
	resolveSkillDirs,
} from "../../runtime/skill/skillsEnv.js";
import { McpConnectionManager } from "../../runtime/mcp/McpConnectionManager.js";
import { MCP_SERVERS_ENV, parseMcpEnv } from "../../runtime/mcp/mcpEnv.js";
import { findPendingToolIds } from "../../runtime/loop/AgentLoop.js";
import type { ApprovalQueueItem } from "../../conversation/server/WaitRequestQueue.js";
import { buildNovelExplorerAgent } from "../../runtime/agent/NovelExplorerAgent.js";
import { buildNovelComposeAgent } from "../../runtime/agent/NovelComposeAgent.js";
import {
	buildBookAnalystAgent,
	BOOK_ANALYST_AGENT_TYPE,
} from "../../runtime/agent/BookAnalystAgent.js";
import {
	PROJECT_IMPORTER_AGENT_TYPE,
	projectImporterAgentDefinition,
} from "../../runtime/agent/definitions/ProjectImporterAgentDefinition.js";
import { SqliteNovelStore } from "../../novel/SqliteNovelStore.js";
import { LibraryService } from "../../library/LibraryService.js";
import { bookDbPath } from "../../library/LibraryPaths.js";
import type { NovelQuery } from "../../novel/contract/query.js";
import type { NovelMutation } from "../../novel/contract/mutation.js";
import type { ProjectedEvent } from "../../conversation/contract/events/index.js";
import type { ConversationMode } from "../../conversation/contract/types/index.js";

/** 平台显示名（动态段 core.environment 用） */
const PLATFORM_LABELS: Readonly<Record<string, string>> = Object.freeze({
	darwin: "macOS",
	linux: "Linux",
	win32: "Windows",
});

/** CMS 调用面（子进程 getAPI 视图） */
interface CmsApi {
	register(meta: { conversationId: string; name: string; storeDir: string }): Promise<void>;
	submitApproval(conversationId: string, req: unknown): Promise<void>;
	submitAsking(conversationId: string, req: unknown): Promise<void>;
	submitExitCompose(conversationId: string, req: unknown): Promise<void>;
	takeDecisions(conversationId: string): Promise<readonly ApprovalQueueItem[]>;
}

/** 把 holder 里的 conversation 转发为 expose 面（方法全集；直接执行，不能返回内层闭包） */
function conversationExposeOf(holder: { conv?: Conversation }): Record<string, unknown> {
	const requireConv = (): Conversation => {
		if (holder.conv === undefined) throw new Error("conversation 尚未装配");
		return holder.conv;
	};
	return {
		sendUserMessage: (...args: unknown[]) => {
			debugLog("[child] sendUserMessage 到达", String(args[0] === undefined ? "" : JSON.stringify(args[0])).slice(0, 120));
			return requireConv().sendUserMessage(args[0] as never);
		},
		sendUserCommand: (...args: unknown[]) => requireConv().sendUserCommand(args[0] as never),
		sendSystemControl: (...args: unknown[]) => requireConv().sendSystemControl(args[0] as never),
		sendApprovalRequest: (...args: unknown[]) => requireConv().sendApprovalRequest(args[0] as never),
		sendAskingQuestionRequest: (...args: unknown[]) => requireConv().sendAskingQuestionRequest(args[0] as never),
		sendExitComposeRequest: (...args: unknown[]) => requireConv().sendExitComposeRequest(args[0] as never),
		subscribeEvents: (...args: unknown[]) => {
			debugLog("[child] subscribeEvents 到达");
			return requireConv().subscribeEvents(args[0] as (e: ProjectedEvent) => void);
		},
		resolveApproval: (...args: unknown[]) =>
			requireConv().resolveApproval(args[0] as string, args[1] as never),
		resolveQuestion: (...args: unknown[]) =>
			requireConv().resolveQuestion(args[0] as string, args[1] as never),
		resolveExitCompose: (...args: unknown[]) =>
			requireConv().resolveExitCompose(args[0] as string),
		getConversationMode: () => requireConv().getConversationMode(),
		dispose: () => requireConv().dispose(),
	};
}

/** child 崩溃自曝日志路径 env（ProcessSpawner 注入） */
const CHILD_LOG_ENV = "NOVEL_DESKTOP_CHILD_LOG" as const;

/** 合法会话模式集合（meta.json 恢复校验用） */
const KNOWN_MODES = new Set(["review", "bypass", "compose"]);

/** 采样覆盖 env（NOVEL_PROVIDER_* 同族；main 侧 env 透传即生效，非法值忽略回落默认） */
const PROVIDER_MAX_TOKENS_ENV = "NOVEL_PROVIDER_MAX_TOKENS" as const;
const PROVIDER_THINKING_ENV = "NOVEL_PROVIDER_THINKING" as const;

/** BookAnalyst 思考档位 env：解析是抽取型任务（照 manifest 读批 → 建 scene/leaf 实体），
 * 高档思考只烧输出 token 与每轮延迟——缺省 low（1 万字实测：high 695s / low 174s，
 * leaf 密度持平；off 292s 但 leaf 事件数掉到 1 条/场景且出现编造 paragraph id） */
const ANALYST_THINKING_ENV = "NOVEL_ANALYST_THINKING" as const;

/** Compose 案例意图分类开关（默认关——PRD compose-案例引导：索引+自读为主通道，
 *  分类与 <novel-guide> msg 注入待作者验证后经此 env 显式开启） */
const COMPOSE_GUIDE_CLASSIFY_ENV = "NOVEL_COMPOSE_GUIDE_CLASSIFY" as const;

/** Agent 运行参数 env（RuntimeSettings 解析产物 JSON；main 侧序列化，spawn 时继承。
 *  新对话生效：配置变更后 main 重写 env，已启动进程维持启动时快照） */
const RUNTIME_SETTINGS_ENV = "NOVEL_RUNTIME_SETTINGS" as const;

/**
 * 绑定会话事件 PUB（每会话一个 ipc:// 命名管道地址；main 侧 register 后 SUB 接入）。
 * bind 失败（地址占用等）→ 告警并返回 undefined（内存 hub 照常分发）。
 */
async function bindConversationEventPublisher(
	conversationId: string,
	logger?: Logger,
): Promise<ConversationEventPublisher | undefined> {
	const publisher = new EventPublisher(conversationEventsAddr(conversationId));
	try {
		await publisher.bind();
		return publisher;
	} catch (err) {
		logger?.error("conversation_events.bind_failed", {
			conversationId,
			error: err instanceof Error ? err.message : String(err),
		});
		return undefined;
	}
}

/** 读 storedir/meta.json 的持久化模式（无文件/损坏/非法值 → undefined 回退默认） */
export function readPersistedMode(storedir: string | undefined): ConversationMode | undefined {
	if (storedir === undefined || storedir.trim() === "") return undefined;
	try {
		const parsed = JSON.parse(readFileSync(join(storedir, "meta.json"), "utf8")) as { mode?: unknown };
		return typeof parsed.mode === "string" && KNOWN_MODES.has(parsed.mode)
			? (parsed.mode as ConversationMode)
			: undefined;
	} catch {
		return undefined;
	}
}

/** 合并写 storedir/meta.json 的 mode 字段（保留 name 等其他字段；失败忽略：内存态仍生效） */
export function persistMode(storedir: string | undefined, mode: ConversationMode): void {
	if (storedir === undefined || storedir.trim() === "") return;
	const path = join(storedir, "meta.json");
	try {
		let existing: Record<string, unknown> = {};
		try {
			existing = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		} catch {
			// 无文件/损坏：从空对象起步
		}
		writeFileSync(path, JSON.stringify({ ...existing, mode }), "utf8");
	} catch {
		// 落盘失败忽略（重启回退默认模式）
	}
}

/** id → 调试输出目录安全段（agentId 形如 "Explore:<taskId>"，":" 在 Windows 路径非法） */
function toDebugDirSegment(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "-");
}

/** 合法思考档位全集（env 校验用） */
const THINKING_LEVELS: ReadonlySet<ThinkingLevel> = new Set([
	"off",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

/** env → 正整数（缺省/空白/非法返回 undefined，调用方回落默认） */
function readPositiveIntEnv(name: string): number | undefined {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === "") return undefined;
	const value = Number.parseInt(raw, 10);
	return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** env → 思考档位（缺省/非法返回 undefined，调用方回落默认） */
function readThinkingLevelEnv(name: string): ThinkingLevel | undefined {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === "") return undefined;
	return THINKING_LEVELS.has(raw as ThinkingLevel) ? (raw as ThinkingLevel) : undefined;
}

/** 崩溃自曝：同步写堆栈到 runtime-child.log + 回写 stderr（父进程捕获缓冲），再按原语义退出。 */
function writeCrashTrace(line: string): void {
	// 父进程 stderr 捕获埋点（runtime.process.child_stderr）也会收到这份内容。
	console.error(line);
	const childLogPath = process.env[CHILD_LOG_ENV];
	if (childLogPath === undefined || childLogPath.length === 0) return;
	try {
		appendFileSync(childLogPath, `${line}\n`);
	} catch {
		// console.error 已兜底；日志路径不可写不应掩盖崩溃本身。
	}
}

/** 崩溃原因 → 堆栈文本（非 Error 兜底 String） */
function describeCrash(reason: unknown): string {
	if (reason instanceof Error) {
		return reason.stack ?? `${reason.name}: ${reason.message}`;
	}
	return `unknown crash reason: ${String(reason)}`;
}

/** 注册崩溃自曝（在任何其他逻辑之前）：未捕获异常/拒绝写盘后 exit(1)。 */
function registerCrashHandlers(): void {
	process.on("uncaughtException", (error) => {
		writeCrashTrace(`CRASH uncaughtException\n${describeCrash(error)}`);
		process.exit(1);
	});
	process.on("unhandledRejection", (reason) => {
		writeCrashTrace(`CRASH unhandledRejection\n${describeCrash(reason)}`);
		process.exit(1);
	});
}

/**
 * 启动 conversation 子进程（manager WS 双工）
 */
export async function runDesktopRuntimeChildEntrypoint(): Promise<void> {
	// 崩溃诊断：一切逻辑之前注册（stderr 回写 + runtime-child.log 落盘，根因因此可见；
	// 覆盖 be1868d 的内联兜底——writeCrashTrace 先 console.error 再落盘，是其超集）
	registerCrashHandlers();
	const conversationId = process.env.CONVERSATION_ID ?? "main";
	const storedir = process.env.NOVEL_CONVERSATION_STOREDIR;
	// agentType 分发（spawner 注入；缺省 novel 主 Agent）。BookAnalyst = 书库完本
	// 解构后台会话：工作区=书库根、任务载荷 task.json 驱动自动开跑、bypass 模式
	const agentType = process.env.NOVEL_AGENT_TYPE ?? "novel";
	const isAnalyst = agentType === BOOK_ANALYST_AGENT_TYPE;
	const isImporter = agentType === PROJECT_IMPORTER_AGENT_TYPE;
	const analystTask = isAnalyst ? readAnalystTask(process.env.NOVEL_ANALYST_TASK) : undefined;
	if (isAnalyst && analystTask === undefined) {
		writeCrashTrace("CRASH analyst task payload missing（NOVEL_ANALYST_TASK 未注入或损坏）");
		process.exit(1);
	}
	// ProjectImporter = 项目导入解构后台会话：工作区=项目根（novel 同款 env）、任务载荷
	// task.json 驱动自动开跑、bypass 模式；写面为当前项目 novel.db（经 WS，进度实时可见）
	const importerTask = isImporter ? readImporterTask(process.env.NOVEL_ANALYST_TASK) : undefined;
	if (isImporter && importerTask === undefined) {
		writeCrashTrace("CRASH importer task payload missing（NOVEL_ANALYST_TASK 未注入或损坏）");
		process.exit(1);
	}
	const workspace = isAnalyst
		? (process.env.NOVEL_LIBRARY_ROOT ?? ".")
		: (process.env.NOVEL_CONVERSATION_WORKSPACE ?? ".");
	// 运行参数（设置页 RuntimeSettings：档位/采样/压缩/能力，main 解析后序列化为 env）。
	// 非法/缺省整体回落 NOVEL_PROVIDER_* env 默认
	const runtimeSettings = parseRuntimeSettingsEnv(process.env[RUNTIME_SETTINGS_ENV]);
	const novelRuntime = runtimeSettings?.agents.novel;
// ProjectImporter 走独立采样面（设置页可覆盖；缺省 thinking=low，与 BookAnalyst 同
// 依据——抽取型任务 high 只加延迟）
const importerRuntime = runtimeSettings?.agents.ProjectImporter;
// 技能装载（NOVEL_SKILLS_SETTINGS：应用级根目录 + 禁用名单，main 序列化注入）。
// 项目级目录 = <workspace>/skills 由本进程派生；后台会话（BookAnalyst / ProjectImporter）不装技能。
// 注册表 load 失败/目录缺失均回退空集（skill 工具回「不存在」），不阻断会话。
const skillsDescriptor =
	isAnalyst || isImporter ? undefined : parseSkillsEnv(process.env[SKILLS_SETTINGS_ENV]);
const skillRegistry = new SkillRegistry({
	dirs: skillsDescriptor !== undefined ? resolveSkillDirs(skillsDescriptor, workspace) : [],
	disabled: skillsDescriptor?.disabled,
});
await skillRegistry.load();
	// 采样：runtime 优先，其次 NOVEL_PROVIDER_* env。默认 8192/high
	// ——reasoning 模型的思考 token 计入 max_completion_tokens 预算，上限过低会被
	// 思考独占导致空回复/截断（finish_reason=length）
	// BookAnalyst 例外：不经 runtimeSettings（那是创作 agent 的配置面），独立 env +
	// 缺省 low（抽取型任务；off 实测 leaf 变薄且会编造 id，high 只加延迟）
	const sampling: AgentRunConfig["sampling"] = {
		model: isImporter
			? (importerRuntime?.model ?? process.env.NOVEL_PROVIDER_MODEL ?? "deepseek-v4-flash")
			: isAnalyst
				? (process.env.NOVEL_PROVIDER_MODEL ?? "deepseek-v4-flash")
				: (novelRuntime?.model ?? process.env.NOVEL_PROVIDER_MODEL ?? "deepseek-v4-flash"),
		maxTokens: isImporter
			? (importerRuntime?.maxTokens ?? readPositiveIntEnv(PROVIDER_MAX_TOKENS_ENV) ?? 8192)
			: (novelRuntime?.maxTokens ?? readPositiveIntEnv(PROVIDER_MAX_TOKENS_ENV) ?? 8192),
		thinking: isImporter
			? (importerRuntime?.thinking ?? readThinkingLevelEnv(ANALYST_THINKING_ENV) ?? "low")
			: isAnalyst
				? (readThinkingLevelEnv(ANALYST_THINKING_ENV) ?? "low")
				: (novelRuntime?.thinking ?? readThinkingLevelEnv(PROVIDER_THINKING_ENV) ?? "high"),
		...(isImporter && importerRuntime?.temperature !== undefined
			? { temperature: importerRuntime.temperature }
			: !isImporter && novelRuntime?.temperature !== undefined
				? { temperature: novelRuntime.temperature }
				: {}),
	};

	// novel-db：经 kkrpc/ws 连接 main 的 NovelDbWsServer（协议定稿 transport；token 走 subprotocol）。
	// 无 NOVEL_DB_WS_URL（独立脚本/开发）回退进程内内存 store。
	// BookAnalyst 分支：不经 WS，进程内直开该书 book.db（唯一写者，PRD library F5）。
	let novelHandle: NovelHandle;
	let analystStore: SqliteNovelStore | undefined;
	const novelWsUrl = process.env.NOVEL_DB_WS_URL;
	if (isAnalyst && analystTask !== undefined) {
		analystStore = new SqliteNovelStore(bookDbPath(workspace, analystTask.bookId));
		const store = analystStore;
		novelHandle = {
			query: (q: NovelQuery) => store.query(q),
			mutate: (m: NovelMutation) => store.mutate(m),
			mutateBatch: (ms: readonly NovelMutation[]) => store.mutateBatch(ms),
		} as unknown as NovelHandle;
	} else if (novelWsUrl !== undefined && novelWsUrl.trim() !== "") {
		const wsToken = process.env.NOVEL_DB_WS_TOKEN;
		novelHandle = new NovelHandle(
			webSocketClientTransport({
				url: novelWsUrl,
				protocols: wsToken !== undefined && wsToken !== "" ? [wsToken] : undefined,
			}),
		);
	} else {
		const store = new InMemoryNovelStore();
		novelHandle = {
			query: (q: NovelQuery) => store.query(q),
			mutate: (m: NovelMutation) => store.mutate(m),
			mutateBatch: (ms: readonly NovelMutation[]) => store.mutateBatch(ms),
		} as unknown as NovelHandle;
	}
	// ProjectImporter 章卷一致守卫：handle 层拒绝卷/章/段落写（publication.* / paragraph.*）。
	// novel.entities 的 NovelWrite 是 kind 分发通用工具（工具名级 deny 挡不住 kind），
	// 在 handle 收口为确定性双保险——写库面只剩 outline.*/character.*/location.*。
	// 例外通道：NovelImportText（novel.import 组）持原始 handle 做确定性区间导入
	// （paragraph.insert + 章回填；参数面无文本，正文从批次文件搬运）。
	let importerRawHandle: NovelHandle | undefined;
	if (isImporter) {
		importerRawHandle = novelHandle;
		novelHandle = guardImporterHandle(novelHandle);
	}

	// journal：storedir（manager 分配，经 env 传入）可用时建立 + open（恢复 seq）。
	// server 模式（NOVEL_SERVER_URL）：Http 上推实现（append/rewrite 走 REST，断线落 sidecar 待推队列）；
	// 恢复上下文改从 server 重放折叠（本地无 journal 文件）。
	const serverUrl = process.env.NOVEL_SERVER_URL?.trim();
	// bundle 模式（FR6）：NOVA_AGENT_MODE=bundle + NOVA_DEFINITION_BUNDLE（JSON 文件路径）。
	// 读包失败/未配置 → undefined（legacy 装配）；能力校验失败回退在 buildNovelAgent 内收口。
	let agentBundle: import("../../runtime/definition/bundle.js").DefinitionBundle | undefined;
	if (process.env.NOVA_AGENT_MODE === "bundle" && process.env.NOVEL_DEFINITION_BUNDLE) {
		try {
			agentBundle = JSON.parse(
				readFileSync(process.env.NOVEL_DEFINITION_BUNDLE, "utf8"),
			) as import("../../runtime/definition/bundle.js").DefinitionBundle;
		} catch (err) {
			debugLog(`[bundle] 定义包读取失败，回退 legacy: ${String(err)}`);
		}
	}
	let journal: import("../../conversation/contract/journal/index.js").ConversationJournalService | undefined;
	if (storedir !== undefined && storedir.trim() !== "") {
		if (serverUrl !== undefined && serverUrl !== "") {
			const accessFile = process.env.NOVEL_SERVER_ACCESS_FILE ?? "";
			journal = new HttpConversationJournalService({
				conversationId,
				url: serverUrl,
				pendingPath: join(storedir, "pending-push.jsonl"),
				// main 进程持有会话并周期刷新落 access 文件（15min TTL；子进程现读现用）
				getAccessToken: async () => {
					try {
						const raw = await readFileAsync(accessFile, "utf8");
						return (JSON.parse(raw) as { accessToken?: string }).accessToken;
					} catch {
						return undefined;
					}
				},
				// 租约由 run 生命周期管理（FR5：申请/心跳/释放），此处仅取持有值
				getLeaseToken: () => currentLeaseToken,
				definitionVersion: agentBundle?.definitionVersion ?? process.env.NOVEL_DEFINITION_VERSION,
			});
		} else {
			journal = new FileConversationJournalService({
				conversationId,
				filePath: join(storedir, "journal.jsonl"),
			});
		}
	}
	await journal?.open();
	// server 模式租约 token 槽（FR5 接线 run 生命周期申请；此处先暴露可更新引用）
	let currentLeaseToken: string | undefined = process.env.NOVEL_LEASE_TOKEN;

	// 恢复上下文：journal 已落盘 runs → run 边界 + resumeSeq（崩溃重派生续跑）。
	// run 边界保留传递（context-compact PRD：压缩分区/摘要标记跨重启保持）
	let runMessages: LLMessage[] | undefined;
	let resumeRuns: { seq: number; messages: LLMessage[]; ts?: string }[] | undefined;
	let resumeSeq: number | undefined;
	if (journal !== undefined && storedir !== undefined) {
		if (serverUrl !== undefined && serverUrl !== "") {
			// server 模式恢复：重放账本按 run_seq 折叠（snapshot 重置基线 + append 追加）
			const runs = await readRunsFromServer(serverUrl, conversationId);
			runMessages = runs.flatMap((r) => r.messages);
			resumeRuns = runs.map((r) => ({ seq: r.seq, messages: r.messages, ts: r.ts }));
			resumeSeq = journal.lastSeq;
		} else {
			const readOnly = new FileConversationJournalReadOnlyService({ journalDir: storedir });
			const runs = await readOnly.readRuns(conversationId);
			runMessages = runs.flatMap((r) => r.messages);
			resumeRuns = runs.map((r) => ({ seq: r.seq, messages: r.messages, ts: r.ts }));
			resumeSeq = journal.lastSeq;
		}
	}

	// manager WS：单连接双工（expose conversation + getAPI 调 CMS）
	const managerWsUrl = process.env.NOVEL_MANAGER_WS_URL;
	const holder: { conv?: Conversation } = {};
	let cmsApi: CmsApi | undefined;
	let resumePendingDecider: ((toolCallId: string) => Promise<"approve" | "reject" | "expired" | undefined>) | undefined;
	/** CMS 待决条目（toolCallId → 条目；重启补完 + ExitComposeMode 决议包装共用） */
	const byToolCallId = new Map<string, ApprovalQueueItem>();
	if (managerWsUrl !== undefined && managerWsUrl.trim() !== "") {
		const wsToken = process.env.NOVEL_MANAGER_WS_TOKEN;
		const channel = new RPCChannel(
			webSocketClientTransport({
				url: managerWsUrl,
				protocols: wsToken !== undefined && wsToken !== "" ? [wsToken] : undefined,
			}),
			{ expose: conversationExposeOf(holder) },
		);
		cmsApi = channel.getAPI() as unknown as CmsApi;
		// 重启补完路径：查询 CMS 待决决策 → 暂停点续跑决策器
		//（审批按 turn 批量：条目的每个 toolCalls 成员都映射到该批决策）
		const decisions = await cmsApi.takeDecisions(conversationId).catch(() => []);
		for (const item of decisions) {
			for (const tc of item.toolCalls) byToolCallId.set(tc.toolCallId, item);
		}
		resumePendingDecider = async (toolCallId) => {
			const item = byToolCallId.get(toolCallId);
			if (item === undefined) return undefined;
			switch (item.status) {
				case "approved":
					return "approve";
				case "rejected":
				case "edited":
					return "reject";
				case "expired":
					return "expired";
				default:
					return undefined; // pending（理论不出现：驻留进程退出时 CMS 已标记过期）
			}
		};
	}

	// provider 配置（novel 运行参数优先，缺省 env 默认；main 与 subagent builder 共享兜底）。
	// ProjectImporter 会话：连接配置优先取自己的 runtime 条目（设置页可为它独立配 profile；
	// 否则回落 novel 档 / env——模型与连接同源，避免模型取 importer 档而连接取 novel 档）
	const providerConfig = isImporter && importerRuntime !== undefined
		? {
				type: importerRuntime.provider,
				...(importerRuntime.baseUrl !== undefined ? { baseUrl: importerRuntime.baseUrl } : {}),
				apiKey: importerRuntime.apiKey,
			}
		: novelRuntime !== undefined
		? {
				type: novelRuntime.provider,
				...(novelRuntime.baseUrl !== undefined ? { baseUrl: novelRuntime.baseUrl } : {}),
				apiKey: novelRuntime.apiKey,
			}
		: {
				type: (process.env.NOVEL_PROVIDER_TYPE as "openai" | "anthropic" | undefined) ?? "openai",
				baseUrl: process.env.NOVEL_PROVIDER_BASE_URL ?? "https://api.deepseek.com/v1",
				apiKey: process.env.NOVEL_PROVIDER_API_KEY,
			};
	// 模型能力覆盖（设置页 profile.capabilities）：注册到共享 registry，覆盖按名启发式；
	// 全部 provider 实例共用（压缩窗口查询 / 温度过滤 / 思考映射一致）
	const modelInfoRegistry = new ModelInfoRegistry();
	for (const info of runtimeSettings?.modelInfos ?? []) {
		modelInfoRegistry.register(info.model, {
			...modelInfoRegistry.getModelInfo(info.model),
			...info.capabilities,
		});
	}
	// 注：后台会话的请求超时/限次重试修复暂缓——先经 provider.call.* 观测日志锁定
	// 「首调用悬挂」根因（见下方 wrapProviderWithLogging），确认后再上行为变更
	const provider = createProvider({ id: "default", ...providerConfig }, modelInfoRegistry);
	/** runtime 条目 → provider 连接配置（条目缺省回落 env 默认连接） */
	const runtimeProviderConfig = (rt: ResolvedAgentConnection | undefined) =>
		rt === undefined
			? providerConfig
			: {
					type: rt.provider,
					...(rt.baseUrl !== undefined ? { baseUrl: rt.baseUrl } : {}),
					apiKey: rt.apiKey,
				};
	/** runtime 条目 → 采样配置（字段缺省回落主采样） */
	const toAgentSampling = (rt: ResolvedAgentConnection | undefined): SamplingConfig =>
		rt === undefined
			? sampling
			: {
					model: rt.model,
					maxTokens: rt.maxTokens ?? sampling.maxTokens,
					thinking: rt.thinking ?? sampling.thinking,
					...(rt.temperature !== undefined ? { temperature: rt.temperature } : {}),
				};

	/** compose 案例分类器采样：Fast 档语义（Explore 档优先，回落主采样——缺省模型
	 * 即 flash 档）；maxTokens 收紧 + 关思考（分类是抽取型任务，PRD compose-案例引导 F5） */
	const composeClassifierSampling = (): SamplingConfig => {
		const base = toAgentSampling(runtimeSettings?.agents.Explore);
		return { ...base, maxTokens: Math.min(base.maxTokens ?? 1024, 1024), thinking: "off" };
	};

	// explorer 专用 todo 存储（与 main 计划分离：TodoWrite 整体替换语义，
	// 扫描进度草稿不覆盖 main 的执行计划；两者同为进程内内存级）
	const todoStore = new InMemoryConversationTodoStore();

	// provider-call 调试（NOVEL_DEBUG，gui:debug 经 ProcessSpawner env 透传注入）：
	// jsonl + html 落盘到 storedir/debug/<agentId>/（无 storedir 的独立脚本/dev 回退
	// cwd 相对 debug/<conversationId>/<agentId>/）；html 增量写入，会话进行中即可打开查看
	const providerDebugEnabled = (process.env.NOVEL_DEBUG ?? "").trim() !== "";
	const providerDebugBaseDir =
		storedir !== undefined && storedir.trim() !== ""
			? join(storedir, "debug")
			: join("debug", toDebugDirSegment(conversationId));
	const createCallDebugger = providerDebugEnabled
		? (agentId: string) =>
				new ProviderCallDebugger({
					enabled: true,
					dir: join(providerDebugBaseDir, toDebugDirSegment(agentId)),
				})
		: undefined;

	// 案例引导 seed（进程级共享 memo：main 与 Compose 的规范段「参考案例」小节
	// 共用一次 seed；扫描走 mtime 缓存）。logger 闭包后置——调用时已初始化
	let agentCasesSeeded: Promise<boolean> | undefined;
	const ensureAgentCasesSeeded = () =>
		(agentCasesSeeded ??= seedAgentCasesIfNeeded(workspace, logger));
	// 质量规范段「参考案例」小节的快照来源（main 与 Compose 同源；空库 → undefined
	// 仅省略小节，规范正文恒渲染）
	const caseGuideSnapshotProvider = async () => {
		await ensureAgentCasesSeeded();
		const entries = await scanAgentCases(workspace, logger);
		if (entries === undefined || entries.length === 0) return undefined;
		return { entries, casesDir: AGENT_CASES_DIR };
	};

	// subagent 任务编排：builder 每任务新建 provider（流式累积状态不可跨 loop 共享）。
	// BookAnalyst / ProjectImporter 不委托子代理（delegation disabled）——不装配编排；
	// 运行参数存在时：Explore/Compose 各自走解析后的连接与采样（如 Explore → Fast 档）
	const subagentRuntime = isAnalyst || isImporter
		? undefined
		: new SubagentRuntime({
				sampling,
				...(runtimeSettings !== undefined
					? {
							samplingByAgent: {
								Explore: toAgentSampling(runtimeSettings.agents.Explore),
								Compose: toAgentSampling(runtimeSettings.agents.Compose),
							},
						}
					: {}),
				builders: {
					Explore: (agentId) =>
						buildNovelExplorerAgent({
							workspace,
							provider: createProvider(
								{ id: "explorer", ...runtimeProviderConfig(runtimeSettings?.agents.Explore) },
								modelInfoRegistry,
							),
							handle: novelHandle,
							todoStore,
							conversationId,
							agentId,
							debugger: createCallDebugger?.(agentId),
						}),
				Compose: (agentId) => {
					// compose 案例引导装配（PRD compose-案例引导）：案例索引经共享质量
					// 规范段「参考案例」小节常驻（与 main 同源快照）；意图分类默认关
					// （COMPOSE_GUIDE_CLASSIFY_ENV 显式开启）——关闭时无 <novel-guide>
					// msg 注入，按索引自读为主通道
					const classifyEnabled =
						/^(1|true)$/i.test(process.env[COMPOSE_GUIDE_CLASSIFY_ENV] ?? "");
					const classifier = classifyEnabled
						? new LlmIntentClassifier({
								provider: createProvider(
									{
										id: "compose-classifier",
										...runtimeProviderConfig(runtimeSettings?.agents.Compose),
										timeoutMs: 15_000,
									},
									modelInfoRegistry,
								),
								sampling: composeClassifierSampling(),
							})
						: undefined;
					const ensureSeeded = () => ensureAgentCasesSeeded();
					let guideOnce: Promise<LLMessage[] | undefined> | undefined;
					return buildNovelComposeAgent({
						workspace,
						provider: createProvider(
							{ id: "compose", ...runtimeProviderConfig(runtimeSettings?.agents.Compose) },
							modelInfoRegistry,
						),
						handle: novelHandle,
						todoStore,
						conversationId,
						agentId,
						debugger: createCallDebugger?.(agentId),
						caseGuideProvider: caseGuideSnapshotProvider,
						composeGuideSeed: (input) =>
							(guideOnce ??= (async () => {
								if (classifier === undefined) return undefined;
								await ensureSeeded();
								const entries = await scanAgentCases(workspace, logger);
								if (entries === undefined || entries.length === 0) return undefined;
								const tags = await classifier.classify(input, entries);
								const selected = selectGuideCases(entries, tags);
								const items: { entry: (typeof selected)[number]; content: string }[] = [];
								for (const entry of selected) {
									const content = await readAgentCaseContent(workspace, entry.file);
									if (content !== undefined) items.push({ entry, content });
								}
								const message = wrapNovelGuideMessage(items);
								return message !== undefined ? [message] : undefined;
							})()),
					});
				},
				},
			});

	// 进程结构化日志：pino（storedir/logs 下每进程独占文件 + stderr 彩色行）。
	// 级别：NOVEL_LOG_LEVEL（info=release 默认 / verbose=debug）——verbose 映射 pino debug。
	const logger =
		storedir !== undefined && storedir.trim() !== ""
			? await createLogger({
					name: "conversation",
					id: conversationId,
					logDir: join(storedir, "logs"),
					level: process.env.NOVEL_LOG_LEVEL === "verbose" ? "debug" : "info",
				})
			: undefined;
	// debug 开启提示：定位 provider-calls.{jsonl,html}（main 与 subagent 同基目录，按 agentId 分目录）
	if (providerDebugEnabled) {
		logger?.info("child.provider_debug", { baseDir: providerDebugBaseDir });
	}
	// 后台会话根因诊断（零行为变化）：① 记录实际生效的 provider 连接（type/baseUrl/密钥在位）；
	// ② 包装 provider 输出调用全生命周期日志（start/first_delta/done/error + 耗时）——端点停滞时
	// openai SDK 默认静默重试不产生任何应用日志，此包装让「首调用悬挂」的卡层与最终结局可见
	if (isImporter || isAnalyst) {
		logger?.info("child.background.provider_config", {
			agentType,
			type: providerConfig.type,
			baseUrl: providerConfig.baseUrl,
			hasApiKey: providerConfig.apiKey !== undefined,
		});
	}
	const loopProvider: Provider =
		isImporter || isAnalyst ? wrapProviderWithLogging(provider, () => logger) : provider;

	// ① compose 状态与服务：状态实例先 hydrate（state.jsonl 重放）再装配——
	// 顺序保证：nudge 策略构造（buildNovelAgent 内）时 latch 已 seed（重启不误发上升沿）
	const composeState = new ComposeModeStateProvider();
	const composeService = new ComposeModeService({
		composeState,
		designRoot: join(workspace, ".novel", "design"),
		// 挂起审批探测：mode 切换延迟判定（holder 闭包，conv 构造后可用）
		pendingApprovalProbe: () => Promise.resolve(holder.conv?.hasPendingApproval() ?? false),
		logger,
	});
	const stateJournal =
		storedir !== undefined && storedir.trim() !== ""
			? new FileConversationStateJournalService({ filePath: join(storedir, "state.jsonl") })
			: undefined;
	if (storedir !== undefined && storedir.trim() !== "") {
		const readOnly = new FileConversationJournalReadOnlyService({ journalDir: storedir });
		const stateEvents = await readOnly.readStateEvents(conversationId);
		await composeService.hydrateFromEvents(conversationId, stateEvents);
	}
	// 重启补完的 ExitComposeMode 决议包装：reject/expired 驱动状态回 designing + 晋升延迟目标
	// （approve 决议由 resumePendingRun dispatch 执行 ExitComposeMode handler → service.exit 收口）
	if (resumePendingDecider !== undefined) {
		const baseDecider = resumePendingDecider;
		resumePendingDecider = async (toolCallId) => {
			const decision = await baseDecider(toolCallId);
			const item = byToolCallId.get(toolCallId);
			if (
				item?.toolCalls.some((tc) => tc.toolName === "ExitComposeMode") === true &&
				(decision === "reject" || decision === "expired")
			) {
				await composeService.rejectOnDecision(conversationId);
				await composeService.applyPendingModeTarget(conversationId);
			}
			return decision;
		};
	}

	// 书库只读服务（novel 主 Agent 的 library.read 组）：main 分支暂不接入（避免污染主
	// agent 工具面）；开发在 book-analyst 分支恢复该装配（NOVEL_LIBRARY_ROOT 注入时构造）

	// MCP 服务器（NOVEL_MCP_SERVERS：main 序列化的 enabled 项；BookAnalyst 不接）。
	// 并行连接（单台 8s 上限），失败逐台记录跳过不阻断会话；工具面装配期定死。
	// 注意须在 cmsApi.register 之前完成——spawner 报到超时 15s 自 spawn 起算
	const mcpManager = new McpConnectionManager({ logger });
	const mcpServers = isAnalyst ? undefined : parseMcpEnv(process.env[MCP_SERVERS_ENV]);
	const mcpConnected =
		mcpServers !== undefined
			? await mcpManager.connectAll(mcpServers)
			: { tools: [] as never[], failures: [] as never[] };
	for (const failure of mcpConnected.failures) {
		logger?.warn("child.mcp_connect_failed", {
			conversationId,
			server: failure.server.name,
			error: failure.error,
		});
	}

	// agentType 分发：BookAnalyst = 书库完本解构后台装配（书库根沙盒 + 该书 book.db
	// 读写 + bypass + journal 恢复；无 compose/ask/subagent）；否则 novel 主 Agent。
	const loop = isAnalyst
		? buildBookAnalystAgent({
				libraryRoot: workspace,
				provider: loopProvider,
				store: analystStore as SqliteNovelStore,
				conversationId,
				listeners: journal !== undefined ? [journalListener(journal)] : undefined,
				runMessages,
				resumeSeq,
				logger,
				debugger: createCallDebugger?.("main"),
			})
		: buildNovelAgent({
			workspace,
			provider: loopProvider,
			handle: novelHandle,
			// bundle 模式（FR6，NOVA_AGENT_MODE=bundle）：定义包驱动装配（包经
			// NOVA_DEFINITION_BUNDLE 文件注入——server resolve 拉取后由宿主落盘/缓存）
			...(agentBundle !== undefined ? { bundle: agentBundle } : {}),
			// ProjectImporter：novel 装配 + 派生定义（仅换 prompt 与工具面；后台无人值守，
			// definition 已裁掉 ask/compose 组且 delegation disabled）
			...(isImporter ? { definition: projectImporterAgentDefinition } : {}),
			// novel.import 组（NovelImportText）：原始 handle 确定性写通道
			...(isImporter && importerRawHandle !== undefined
				? { importText: { handle: importerRawHandle } }
				: {}),
			conversationId,
		listeners: journal !== undefined ? [journalListener(journal)] : undefined,
		runMessages,
		resumeRuns,
		resumeSeq,
			requestApproval: (req) => holder.conv!.sendApprovalRequest(req),
			requestAsk: (req) => holder.conv!.sendAskingQuestionRequest(req),
			resumePendingDecider,
			logger,
			debugger: createCallDebugger?.("main"),
			// ProjectImporter delegation disabled：subagent 工具对空白名单抛错，不装配
			subagent:
				!isImporter && subagentRuntime !== undefined
					? { spawner: subagentRuntime }
					: undefined,
		// 压缩阈值（设置页 RuntimeSettings.compaction；缺省项用策略默认值）
		...(runtimeSettings?.compaction !== undefined
			? { compact: runtimeSettings.compaction }
			: {}),
		// 动态段输入：workdir/modelId 由 LoopContext 自组装（workspace /
		// run.sampling.model）；宿主只注入平台常量 + 每调用读 NOVEL.md
		//（失败返回 undefined → 动态段渲染占位）
		platform: PLATFORM_LABELS[process.platform] ?? process.platform,
			novelConstraintsProvider: async () => {
				const content = await readNovelGlobalConstraintsSafe(workspace, logger);
				return content === undefined
					? undefined
					: { fileName: NOVEL_GLOBAL_CONSTRAINTS_FILE_NAME, content };
			},
			// 规范段「参考案例」小节的条目来源（seed + mtime 缓存扫描）
			caseGuideProvider: caseGuideSnapshotProvider,
		// compose 状态（nudge/权限门共享）+ 工具服务（novel.compose 组）+ 每次 provider
		// call 发起时晋升 pendingMode（mode.set 记录后由本钩子生效，PRD F1 双态）
		composeState,
		composeService,
			beforeProviderCall: () => holder.conv?.promotePendingMode() ?? Promise.resolve(),
			todoStore: new InMemoryConversationTodoStore(),
			// 技能注册表（runtime.skills 组；空目录=无技能，工具正确回「不存在」）
			skills: { registry: skillRegistry },
			// MCP 包装工具（组外追加；连接失败的服务器自然缺席；ProjectImporter 后台受限工具面不挂）
			...(mcpConnected.tools.length > 0 && !isImporter ? { extraTools: mcpConnected.tools } : {}),
		});
	// ProjectImporter 里程碑日志（下次「报到超时被 kill」时定位卡点：装配完成→注册→自驱动）
	if (isImporter) {
		logger?.info("child.importer.assembled", {
			conversationId,
			workspace,
			taskLoaded: importerTask !== undefined,
		});
	}

	const managerWait: ManagerWaitChannel | undefined =
		cmsApi !== undefined
			? {
					submitApproval: (id, req) => cmsApi!.submitApproval(id, req as never),
					submitAsking: (id, req) => cmsApi!.submitAsking(id, req as never),
					submitExitCompose: (id, req) => cmsApi!.submitExitCompose(id, req as never),
				}
			: undefined;

	const conv = new Conversation({
		conversationId,
		loop,
		sampling,
		journal,
		managerWait,
		composeState,
		composeService,
		stateJournal,
		subagentRuntime,
		// BookAnalyst / ProjectImporter 恒 bypass（后台无人应答审批；canonical 写自动放行）
		initialMode: isAnalyst || isImporter ? "bypass" : readPersistedMode(storedir),
		onModeChanged: (mode) => persistMode(storedir, mode),
		logger,
		// 事件火线 ZeroMQ 广播（gui-performance-2 功能点八）：每会话一个 PUB，
		// main 侧 register 后 SUB 接入转发 renderer（裸 IPC，无 kkrpc 往返）。
		// bind 失败仅告警降级（内存 hub 照常，renderer 走 kkrpc subscribeEvents 兜底不可用，
		// 表现为投影错误可重试——地址冲突仅在同名会话双开时发生，属配置错误）。
		eventPublisher: await bindConversationEventPublisher(conversationId, logger),
	// 审批等待不设超时：进程驻留，UI 决策随时经 resolveApproval 直推解除
	//（提前 exit 会丢内存态 subagent/todo，且决策无法送达；Exit 审批驻留同理）
	});
	holder.conv = conv;
	// 状态事件出口：先落 state.jsonl 再 hub 广播（写序 ②→③）
	composeService.setEventSink((e) => conv.emitState(e));

	// 报到 CMS（spawner 等待点；此后 manager 侧拿到 conversation handle）。
	// 必须先于 resumePendingRun：恢复可能耗时多轮 provider 调用，晚报到会撞
	// spawner 15s 握手超时被 kill，产生孤儿进程
	if (cmsApi !== undefined) {
		await cmsApi.register({
			conversationId,
			name: conversationId,
			storeDir: storedir ?? "",
		});
		if (isImporter) {
			logger?.info("child.importer.registered", { conversationId });
		}
	} else {
		// 无 manager WS（独立脚本/dev）：stdin end 关 MCP 连接后退出兜底
		process.stdin.on("end", () => {
			void mcpManager.close().finally(() => process.exit(0));
		});
	}

	// 暂停点续跑：仅当恢复消息中存在缺 tool 结果的 toolCall 才补完收口——
	// 已收口的 run（工具结果齐全）不得重跑，否则重复 provider 调用/重复落盘
	if (runMessages !== undefined && findPendingToolIds(runMessages).length > 0) {
		logger?.info("child.resume_pending", {
			conversationId,
			pendingToolCalls: findPendingToolIds(runMessages).length,
			recoveredDecisions: byToolCallId.size,
		});
		await loop.resumePendingRun({ sampling, maxTurns: 8 }).catch((err) => {
			logger?.error("child.resume_failed", { conversationId, error: String(err) });
			debugLog("[child] resumePendingRun failed:", err);
		});
	}

	// BookAnalyst 自动驱动：任务载荷经首条用户消息发起解析 run（journal 已有恢复
	// 消息时跳过——重启续跑优先，不重复发起）。无 manager WS 的独立运行（冒烟）
	// 用心跳定时器驻留，run 收口后由外部（脚本）观察产物并回收进程。
	if (isAnalyst && analystTask !== undefined) {
		if (runMessages === undefined || runMessages.length === 0) {
			const prompt = analystTaskPrompt(analystTask);
			const receipt = await holder.conv!.sendUserMessage({ text: prompt });
			logger?.info("child.analyst.autodrive", {
				conversationId,
				bookId: analystTask.bookId,
				receipt: String(JSON.stringify(receipt)).slice(0, 120),
			});
		}
		if (cmsApi === undefined) {
			setInterval(() => {}, 3_600_000);
		}
	}
	// ProjectImporter 自动驱动：语义同上（任务载荷驱动、重启续跑优先、冒烟心跳驻留）
	if (isImporter && importerTask !== undefined) {
		if (runMessages === undefined || runMessages.length === 0) {
			const prompt = importerTaskPrompt(importerTask);
			const receipt = await holder.conv!.sendUserMessage({ text: prompt });
			logger?.info("child.importer.autodrive", {
				conversationId,
				receipt: String(JSON.stringify(receipt)).slice(0, 120),
			});
		}
		if (cmsApi === undefined) {
			setInterval(() => {}, 3_600_000);
		}
	}
	// 子进程驻留：事件循环由 WS 连接与定时器维持
}

/** BookAnalyst 任务载荷（task.json；导入服务经 spawner 落盘） */
interface AnalystTaskPayload {
	/** 书 id */
	bookId: string;
	/** 书名（缺省取 meta） */
	title?: string;
}

/**
 * 读任务载荷（NOVEL_ANALYST_TASK 指向 task.json）
 * @param envValue env 值（路径）
 * @returns 载荷（缺失/损坏 → undefined）
 */
function readAnalystTask(envValue: string | undefined): AnalystTaskPayload | undefined {
	if (envValue === undefined || envValue.trim() === "") return undefined;
	try {
		const parsed = JSON.parse(readFileSync(envValue, "utf8")) as { bookId?: unknown; title?: unknown };
		if (typeof parsed.bookId !== "string" || parsed.bookId.length === 0) return undefined;
		return {
			bookId: parsed.bookId,
			...(typeof parsed.title === "string" && parsed.title.length > 0 ? { title: parsed.title } : {}),
		};
	} catch {
		return undefined;
	}
}

/**
 * 构造解析 run 的首条任务消息
 * @param task 任务载荷
 * @returns 任务指令文本
 */
function analystTaskPrompt(task: AnalystTaskPayload): string {
	return [
		"【完本解构任务】",
		`- bookId：${task.bookId}${task.title === undefined ? "" : `（书名：${task.title}）`}`,
		"- 你的工作区即书库根；本书目录为上述 bookId。",
		"- 步骤：Read <bookId>/book.meta.json 与 <bookId>/paragraphs/manifest.jsonl → TodoWrite 建全书计划 → 按 manifest 顺序逐批 Read 分段文件 → 增量产出大纲（幕级 story_unit：时间/地点/人物/事件 + paragraph id 区间）、人物卡、地点卡 → 维护 analysis/style.md 与 analysis/excerpts.md → 收尾自查后把 book.meta.json 的 status 置为「已完成」。",
		"- 引用正文一律写 paragraph id；完成后输出一段简报（章数/幕数/人物数/产物路径）即可，无作者交互。",
	].join("\n");
}

/** ProjectImporter 任务载荷（task.json；项目导入门面经 spawner 落盘） */
interface ImporterTaskPayload {
	/** 源文件名（简报用） */
	sourceName?: string;
	/** 章数（简报用） */
	chapters?: number;
	/** 分批总数（简报用） */
	batches?: number;
}

/**
 * 读 ProjectImporter 任务载荷（NOVEL_ANALYST_TASK 指向 task.json；字段全部可选）
 * @param envValue env 值（路径）
 * @returns 载荷（env 缺失/损坏 → undefined）
 */
function readImporterTask(envValue: string | undefined): ImporterTaskPayload | undefined {
	if (envValue === undefined || envValue.trim() === "") return undefined;
	try {
		const parsed = JSON.parse(readFileSync(envValue, "utf8")) as Record<string, unknown>;
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		return {
			...(typeof parsed.sourceName === "string" ? { sourceName: parsed.sourceName } : {}),
			...(typeof parsed.chapters === "number" ? { chapters: parsed.chapters } : {}),
			...(typeof parsed.batches === "number" ? { batches: parsed.batches } : {}),
		};
	} catch {
		return undefined;
	}
}

/**
 * 构造导入解构 run 的首条任务消息
 * @param task 任务载荷
 * @returns 任务指令文本
 */
function importerTaskPrompt(task: ImporterTaskPayload): string {
	const brief = [
		task.sourceName !== undefined ? `（源文件：${task.sourceName}）` : "",
		task.chapters !== undefined || task.batches !== undefined
			? `（约 ${task.chapters ?? "?"} 章 / ${task.batches ?? "?"} 批）`
			: "",
	].join("");
	return [
		"【导入解构任务】",
		`- 导入产物位于工作区 .novel/import/${brief}`,
		"- 步骤：Read .novel/import/import.json 与 .novel/import/paragraphs/manifest.jsonl → TodoWrite 建全书推进计划 → 按 manifest 顺序分大轮 Read 分段文件 → 增量产出大纲（全书→幕→场景 story unit，全部已实现，synopsis 末尾附「（覆盖 imp-bXXXXXX–imp-bYYYYYY）」）、人物卡、地点卡 → 收尾自查后把 .novel/import/import.json 的 status 置为 \"analyzed\"。",
		"- 硬约束：卷/章/段落与正文由宿主确定性导入，一律只读——不得创建/修改/删除卷、章、段落。",
		"- 完成后输出一段简报（章数/幕数/场景数/人物数/地点数）即可，无作者交互。",
	].join("\n");
}

/**
 * 后台会话 provider 观测包装（零行为变化）：调用 start（模型）/ first_delta（首字节耗时）/
 * done（总耗时+结束原因）/ error（标准化错误名+消息+HTTP 状态）全程留痕。
 * 诊断「首个 provider 调用悬挂」类问题——SDK 静默重试期间应用侧无任何日志，
 * 此包装保证卡层与最终结局（含最终错误）可见。
 * @param inner 原始 provider
 * @param loggerOf 惰性取 logger（包装创建早于 logger 初始化）
 * @returns 同接口包装实例
 */
function wrapProviderWithLogging(inner: Provider, loggerOf: () => Logger | undefined): Provider {
	return {
		call: async (call, onDelta) => {
			const log = loggerOf();
			const model = call.sampling.model;
			const startedAt = Date.now();
			log?.info("provider.call.start", { model });
			let sawDelta = false;
			try {
				const result = await inner.call(call, (delta) => {
					if (!sawDelta) {
						sawDelta = true;
						log?.info("provider.call.first_delta", {
							model,
							elapsedMs: Date.now() - startedAt,
						});
					}
					onDelta?.(delta);
				});
				log?.info("provider.call.done", {
					model,
					elapsedMs: Date.now() - startedAt,
					finishReason: result.finishReason,
					...(result.usage !== undefined
						? { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }
						: {}),
				});
				return result;
			} catch (err) {
				const status = (err as { status?: unknown }).status;
				log?.error("provider.call.error", {
					model,
					elapsedMs: Date.now() - startedAt,
					name: err instanceof Error ? err.name : String(err),
					message: err instanceof Error ? err.message : String(err),
					...(typeof status === "number" ? { status } : {}),
				});
				throw err;
			}
		},
		getModelInfo: (model) => inner.getModelInfo(model),
	};
}

/**
 * ProjectImporter 写面守卫：拒绝卷/章/段落变更（publication.* / paragraph.*）。
 * 章卷一致性硬约束的确定性双保险（prompt 之外）——agent 写库面只剩
 * outline.storyUnit.* / character.* / location.*
 * @param handle 原始 novel handle
 * @returns 守卫后的 handle
 */
function guardImporterHandle(handle: NovelHandle): NovelHandle {
	const assertWritable = (ms: readonly NovelMutation[]): void => {
		for (const m of ms) {
			if (m.op.startsWith("publication.") || m.op.startsWith("paragraph.")) {
				throw new Error(
					`导入解构会话禁止改动卷/章/段落（${m.op}）——结构与正文以宿主确定性导入为准`,
				);
			}
		}
	};
	return {
		query: (q: NovelQuery) => handle.query(q),
		mutate: (m: NovelMutation) => {
			assertWritable([m]);
			return handle.mutate(m);
		},
		mutateBatch: (ms: readonly NovelMutation[]) => {
			assertWritable(ms);
			return handle.mutateBatch(ms);
		},
	} as unknown as NovelHandle;
}

/**
 * server 模式恢复：GET /v1/journal/:id/replay 重放，按 run_seq 折叠为 runs
 * （snapshot 行重置基线 [run]，append 行追加增量；行序 = 账本全序）。
 * 离线/未登录返回空（恢复上下文为空 = 新会话视角，待推队列会在连接恢复后补齐）。
 */
async function readRunsFromServer(
	serverUrl: string,
	conversationId: string,
): Promise<Array<{ seq: number; messages: import("../../runtime/provider/types.js").LLMessage[]; ts?: string }>> {
	const token = process.env.NOVEL_SERVER_ACCESS_FILE
		? await (async () => {
				try {
					const raw = await readFileAsync(process.env.NOVEL_SERVER_ACCESS_FILE!, "utf8");
					return (JSON.parse(raw) as { accessToken?: string }).accessToken;
				} catch {
					return undefined;
				}
			})()
		: undefined;
	if (token === undefined) return [];
	let response: Response;
	try {
		response = await fetch(`${serverUrl}/v1/journal/${encodeURIComponent(conversationId)}/replay`, {
			headers: { authorization: `Bearer ${token}` },
		});
	} catch {
		return [];
	}
	if (response.status !== 200) return [];
	const body = (await response.json()) as {
		events?: Array<{ seq?: number; run_seq?: number; kind?: string; payload?: string; created_at?: number }>;
	};
	const byRun = new Map<number, { seq: number; messages: import("../../runtime/provider/types.js").LLMessage[]; ts?: string }>();
	for (const event of body.events ?? []) {
		const runSeq = event.run_seq ?? 0;
		// replay 行的 payload 是 JSON 字符串（server 原样返回存储列），先 parse 再折叠
		let payload: unknown;
		try {
			payload = JSON.parse(event.payload ?? "null");
		} catch {
			payload = null;
		}
		if (event.kind === "snapshot") {
			const run = Array.isArray(payload) ? (payload[0] as { messages?: unknown }) : undefined;
			const messages = (run?.messages ?? []) as import("../../runtime/provider/types.js").LLMessage[];
			byRun.set(runSeq, { seq: runSeq, messages, ts: event.created_at ? new Date(event.created_at).toISOString() : undefined });
		} else if (event.kind === "append" && byRun.has(runSeq)) {
			const entry = byRun.get(runSeq)!;
			entry.messages = [...entry.messages, ...((Array.isArray(payload) ? payload : []) as import("../../runtime/provider/types.js").LLMessage[])];
		}
	}
	return [...byRun.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}
