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
import { join } from "node:path";
import { RPCChannel } from "kkrpc";
import { webSocketClientTransport } from "kkrpc/ws";
import { Conversation, type ConversationEventPublisher, type ManagerWaitChannel } from "../../conversation/server/Conversation.js";
import { EventPublisher } from "../../event/EventPublisher.js";
import { conversationEventsAddr } from "../../event/topics.js";
import { FileConversationJournalService } from "../../conversation/persistence/FileConversationJournalService.js";
import { FileConversationJournalReadOnlyService } from "../../conversation/persistence/FileConversationJournalReadOnlyService.js";
import { FileConversationStateJournalService } from "../../conversation/persistence/FileConversationStateJournalService.js";
import { journalListener } from "../../conversation/JournalBridge.js";
import { debugLog } from "../../log/debug.js";
import { createLogger } from "../../log/pino.js";
import type { Logger } from "../../log/Logger.js";
import { SubagentRuntime } from "../../conversation/server/SubagentRuntime.js";
import { InMemoryNovelStore } from "../../novel/InMemoryNovelStore.js";
import { NovelHandle } from "../../novel/client/NovelHandle.js";
import { createProvider } from "../../runtime/provider/Provider.js";
import { buildNovelAgent } from "../../runtime/agent/NovelAgent.js";
import { ProviderCallDebugger } from "../../runtime/debug/ProviderCallDebugger.js";
import {
  readNovelGlobalConstraintsSafe,
  NOVEL_GLOBAL_CONSTRAINTS_FILE_NAME,
} from "../workspace/readNovelGlobalConstraints.js";
import {
	AGENT_CASES_DIR,
	readAgentCaseContent,
	renderAgentCasesIndex,
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
import { findPendingToolIds } from "../../runtime/loop/AgentLoop.js";
import type { ApprovalQueueItem } from "../../conversation/server/WaitRequestQueue.js";
import { buildNovelExplorerAgent } from "../../runtime/agent/NovelExplorerAgent.js";
import { buildNovelComposeAgent } from "../../runtime/agent/NovelComposeAgent.js";
import {
	buildBookAnalystAgent,
	BOOK_ANALYST_AGENT_TYPE,
} from "../../runtime/agent/BookAnalystAgent.js";
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
	const analystTask = isAnalyst ? readAnalystTask(process.env.NOVEL_ANALYST_TASK) : undefined;
	if (isAnalyst && analystTask === undefined) {
		writeCrashTrace("CRASH analyst task payload missing（NOVEL_ANALYST_TASK 未注入或损坏）");
		process.exit(1);
	}
	const workspace = isAnalyst
		? (process.env.NOVEL_LIBRARY_ROOT ?? ".")
		: (process.env.NOVEL_CONVERSATION_WORKSPACE ?? ".");
	// 运行参数（设置页 RuntimeSettings：档位/采样/压缩/能力，main 解析后序列化为 env）。
	// 非法/缺省整体回落 NOVEL_PROVIDER_* env 默认
	const runtimeSettings = parseRuntimeSettingsEnv(process.env[RUNTIME_SETTINGS_ENV]);
	const novelRuntime = runtimeSettings?.agents.novel;
	// 采样：runtime 优先，其次 NOVEL_PROVIDER_* env。默认 8192/high
	// ——reasoning 模型的思考 token 计入 max_completion_tokens 预算，上限过低会被
	// 思考独占导致空回复/截断（finish_reason=length）
	// BookAnalyst 例外：不经 runtimeSettings（那是创作 agent 的配置面），独立 env +
	// 缺省 low（抽取型任务；off 实测 leaf 变薄且会编造 id，high 只加延迟）
	const sampling: AgentRunConfig["sampling"] = {
		model: isAnalyst
			? (process.env.NOVEL_PROVIDER_MODEL ?? "deepseek-v4-flash")
			: (novelRuntime?.model ?? process.env.NOVEL_PROVIDER_MODEL ?? "deepseek-v4-flash"),
		maxTokens: novelRuntime?.maxTokens ?? readPositiveIntEnv(PROVIDER_MAX_TOKENS_ENV) ?? 8192,
		thinking: isAnalyst
			? (readThinkingLevelEnv(ANALYST_THINKING_ENV) ?? "low")
			: (novelRuntime?.thinking ?? readThinkingLevelEnv(PROVIDER_THINKING_ENV) ?? "high"),
		...(novelRuntime?.temperature !== undefined ? { temperature: novelRuntime.temperature } : {}),
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

	// journal：storedir（manager 分配，经 env 传入）可用时建立 + open（恢复 seq）
	const journal =
		storedir !== undefined && storedir.trim() !== ""
			? new FileConversationJournalService({
					conversationId,
					filePath: join(storedir, "journal.jsonl"),
				})
			: undefined;
	await journal?.open();

	// 恢复上下文：journal 已落盘 runs → run 边界 + resumeSeq（崩溃重派生续跑）。
	// run 边界保留传递（context-compact PRD：压缩分区/摘要标记跨重启保持）
	let runMessages: LLMessage[] | undefined;
	let resumeRuns: { seq: number; messages: LLMessage[]; ts?: string }[] | undefined;
	let resumeSeq: number | undefined;
	if (journal !== undefined && storedir !== undefined) {
		const readOnly = new FileConversationJournalReadOnlyService({ journalDir: storedir });
		const runs = await readOnly.readRuns(conversationId);
		runMessages = runs.flatMap((r) => r.messages);
		resumeRuns = runs.map((r) => ({ seq: r.seq, messages: r.messages, ts: r.ts }));
		resumeSeq = journal.lastSeq;
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

	// provider 配置（novel 运行参数优先，缺省 env 默认；main 与 subagent builder 共享兜底）
	const providerConfig = novelRuntime !== undefined
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

	// subagent 任务编排：builder 每任务新建 provider（流式累积状态不可跨 loop 共享）。
	// BookAnalyst 不委托子代理（delegation disabled）——不装配编排；
	// 运行参数存在时：Explore/Compose 各自走解析后的连接与采样（如 Explore → Fast 档）
	const subagentRuntime = isAnalyst
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
					// compose 案例引导装配（PRD compose-案例引导）：索引动态段常开
					// （ensureSeeded + .novel/cases 扫描，compose 按索引先查案例再编写）；
					// 意图分类默认关（COMPOSE_GUIDE_CLASSIFY_ENV 显式开启）——关闭时无
					// <novel-guide> msg 注入，索引自读为主通道
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
					let seededOnce: Promise<boolean> | undefined;
					const ensureSeeded = () =>
						(seededOnce ??= seedAgentCasesIfNeeded(workspace, logger));
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
						composeGuideProvider: async () => {
							await ensureSeeded();
							const entries = await scanAgentCases(workspace, logger);
							if (entries === undefined || entries.length === 0) return undefined;
							return { index: renderAgentCasesIndex(entries), casesDir: AGENT_CASES_DIR };
						},
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

	// agentType 分发：BookAnalyst = 书库完本解构后台装配（书库根沙盒 + 该书 book.db
	// 读写 + bypass + journal 恢复；无 compose/ask/subagent）；否则 novel 主 Agent。
	const loop = isAnalyst
		? buildBookAnalystAgent({
				libraryRoot: workspace,
				provider,
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
		provider,
		handle: novelHandle,
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
		subagent: subagentRuntime !== undefined ? { spawner: subagentRuntime } : undefined,
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
		// compose 状态（nudge/权限门共享）+ 工具服务（novel.compose 组）+ 每次 provider
		// call 发起时晋升 pendingMode（mode.set 记录后由本钩子生效，PRD F1 双态）
		composeState,
		composeService,
		beforeProviderCall: () => holder.conv?.promotePendingMode() ?? Promise.resolve(),
		todoStore: new InMemoryConversationTodoStore(),
	});

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
		// BookAnalyst 恒 bypass（后台无人应答审批；canonical 写自动放行 + 免审批文件工具）
		initialMode: isAnalyst ? "bypass" : readPersistedMode(storedir),
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
	} else {
		// 无 manager WS（独立脚本/dev）：stdin end 退出兜底
		process.stdin.on("end", () => process.exit(0));
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
