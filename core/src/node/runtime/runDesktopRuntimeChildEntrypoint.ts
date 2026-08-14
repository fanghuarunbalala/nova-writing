/**
 * runDesktopRuntimeChildEntrypoint：conversation 子进程入口。
 * 从 env 读 provider/manager WS/novel WS 配置，组装 Conversation：
 * - conversation ↔ CMS 全量 rpc 走 manager WS（单连接双工 RPCChannel：expose conversation
 *   + getAPI 调 CMS 面）；stdio 仅 stderr 日志（fd>2 管道禁用，见 CLAUDE.md）
 * - novel-db 走 kkrpc/ws（无 URL 时回退进程内内存 store，开发用）
 * - wait 请求无阻塞：经 managerWait 提交 CMS 队列；决策经 resolveApproval 回传
 *   （驻留直推）；120s 超时 → process.exit（CMS 决策后重启续跑）
 * - 重启恢复：journal 重放 + CMS takeDecisions 查询待决 → 暂停点续跑（resumePendingTurn）
 * - subagent：SubagentRuntime 进程内编排（main 经 Agent/TaskOutput/TaskStop 派发）
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RPCChannel } from "kkrpc";
import { webSocketClientTransport } from "kkrpc/ws";
import { Conversation, type ManagerWaitChannel } from "../../conversation/server/Conversation.js";
import { FileConversationJournalService } from "../../conversation/persistence/FileConversationJournalService.js";
import { FileConversationJournalReadOnlyService } from "../../conversation/persistence/FileConversationJournalReadOnlyService.js";
import { journalListener } from "../../conversation/JournalBridge.js";
import { debugLog } from "../../log/debug.js";
import { createLogger } from "../../log/pino.js";
import { SubagentRuntime } from "../../conversation/server/SubagentRuntime.js";
import { InMemoryNovelStore } from "../../novel/InMemoryNovelStore.js";
import { NovelHandle } from "../../novel/client/NovelHandle.js";
import { createProvider } from "../../runtime/provider/Provider.js";
import { buildNovelAgent } from "../../runtime/agent/NovelAgent.js";
import {
  readNovelGlobalConstraintsSafe,
  NOVEL_GLOBAL_CONSTRAINTS_FILE_NAME,
} from "../workspace/readNovelGlobalConstraints.js";
import { ComposeModeStateProvider } from "../../conversation/compose/ComposeModeState.js";
import { InMemoryConversationTodoStore } from "../../runtime/todo/InMemoryConversationTodoStore.js";
import type { LLMessage } from "../../runtime/provider/types.js";
import type { AgentRunConfig } from "../../runtime/loop/types.js";
import { findPendingToolIds } from "../../runtime/loop/AgentLoop.js";
import type { ApprovalQueueItem } from "../../conversation/server/WaitRequestQueue.js";
import { buildNovelExplorerAgent } from "../../runtime/agent/NovelExplorerAgent.js";
import type { NovelQuery } from "../../novel/contract/query.js";
import type { NovelMutation } from "../../novel/contract/mutation.js";
import type { OutputEvent } from "../../conversation/contract/events/index.js";
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
			return requireConv().subscribeEvents(args[0] as (e: OutputEvent) => void);
		},
		resolveApproval: (...args: unknown[]) =>
			requireConv().resolveApproval(args[0] as string, args[1] as never),
		resolveQuestion: (...args: unknown[]) =>
			requireConv().resolveQuestion(args[0] as string, args[1] as string),
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
	const workspace = process.env.NOVEL_CONVERSATION_WORKSPACE ?? ".";
	const sampling: AgentRunConfig["sampling"] = {
		model: process.env.NOVEL_PROVIDER_MODEL ?? "deepseek-v4-flash",
		maxTokens: 512,
		thinking: "high",
	};

	// novel-db：经 kkrpc/ws 连接 main 的 NovelDbWsServer（协议定稿 transport；token 走 subprotocol）。
	// 无 NOVEL_DB_WS_URL（独立脚本/开发）回退进程内内存 store。
	let novelHandle: NovelHandle;
	const novelWsUrl = process.env.NOVEL_DB_WS_URL;
	if (novelWsUrl !== undefined && novelWsUrl.trim() !== "") {
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

	// 恢复上下文：journal 已落盘 turns → 历史消息 + resumeSeq（崩溃重派生续跑）
	let turnMessages: LLMessage[] | undefined;
	let resumeSeq: number | undefined;
	if (journal !== undefined && storedir !== undefined) {
		const readOnly = new FileConversationJournalReadOnlyService({ journalDir: storedir });
		const turns = await readOnly.readTurns(conversationId);
		turnMessages = turns.flatMap((t) => t.messages);
		resumeSeq = journal.lastSeq;
	}

	// manager WS：单连接双工（expose conversation + getAPI 调 CMS）
	const managerWsUrl = process.env.NOVEL_MANAGER_WS_URL;
	const holder: { conv?: Conversation } = {};
	let cmsApi: CmsApi | undefined;
	let resumePendingDecider: ((toolCallId: string) => Promise<"approve" | "reject" | "expired" | undefined>) | undefined;
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
		const byToolCallId = new Map<string, ApprovalQueueItem>();
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

	// provider 配置（main 与 explorer 共享；type 从 env，缺省 openai）
	const providerConfig = {
		type: (process.env.NOVEL_PROVIDER_TYPE as "openai" | "anthropic" | undefined) ?? "openai",
		baseUrl: process.env.NOVEL_PROVIDER_BASE_URL ?? "https://api.deepseek.com/v1",
		apiKey: process.env.NOVEL_PROVIDER_API_KEY,
	} as const;
	const provider = createProvider({ id: "default", ...providerConfig });

	// explorer 专用 todo 存储（与 main 计划分离：TodoWrite 整体替换语义，
	// 扫描进度草稿不覆盖 main 的执行计划；两者同为进程内内存级）
	const todoStore = new InMemoryConversationTodoStore();

	// subagent 任务编排：builder 每任务新建 provider（流式累积状态不可跨 loop 共享）
	const subagentRuntime = new SubagentRuntime({
		sampling,
		builders: {
			novel_explorer: (agentId) =>
				buildNovelExplorerAgent({
					workspace,
					provider: createProvider({ id: "explorer", ...providerConfig }),
					handle: novelHandle,
					todoStore,
					conversationId,
					agentId,
				}),
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

	const loop = buildNovelAgent({
		workspace,
		provider,
		handle: novelHandle,
		conversationId,
		listeners: journal !== undefined ? [journalListener(journal)] : undefined,
		turnMessages,
		resumeSeq,
		requestApproval: (req) => holder.conv!.sendApprovalRequest(req),
		resumePendingDecider,
		logger,
		subagent: { spawner: subagentRuntime },
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
		// compose_mode nudge 状态提供者（compose 状态机接线不在本期，进入/退出
		// 由后续 conversation 层驱动该实例）；todo_idle/TodoWrite 的内存存储
		composeState: new ComposeModeStateProvider(),
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
		subagentRuntime,
		initialMode: readPersistedMode(storedir),
		onModeChanged: (mode) => persistMode(storedir, mode),
	// 审批等待不设超时：进程驻留，UI 决策随时经 resolveApproval 直推解除
	//（提前 exit 会丢内存态 subagent/todo，且决策无法送达）
	});
	holder.conv = conv;

	// 报到 CMS（spawner 等待点；此后 manager 侧拿到 conversation handle）。
	// 必须先于 resumePendingTurn：恢复可能耗时多轮 provider 调用，晚报到会撞
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
	// 已收口的 turn（工具结果齐全）不得重跑，否则重复 provider 调用/重复落盘
	if (turnMessages !== undefined && findPendingToolIds(turnMessages).length > 0) {
		await loop.resumePendingTurn({ sampling, maxTurns: 8 }).catch((err) => {
			debugLog("[child] resumePendingTurn failed:", err);
		});
	}
	// 子进程驻留：事件循环由 WS 连接与定时器维持
}
