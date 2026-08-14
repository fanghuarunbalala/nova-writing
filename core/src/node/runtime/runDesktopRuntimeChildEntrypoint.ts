/**
 * runDesktopRuntimeChildEntrypoint：conversation 子进程入口。
 * 从 env 读 provider/manager WS/novel WS 配置，组装 Conversation：
 * - conversation ↔ CMS 全量 rpc 走 manager WS（单连接双工 RPCChannel：expose conversation
 *   + getAPI 调 CMS 面）；stdio 仅 stderr 日志（fd>2 管道禁用，见 CLAUDE.md）
 * - novel-db 走 kkrpc/ws（无 URL 时回退进程内内存 store，开发用）
 * - wait 请求无阻塞：经 managerWait 提交 CMS 队列；决策经 resolveApproval 回传
 *   （驻留直推）；120s 超时 → process.exit（CMS 决策后重启续跑）
 * - 重启恢复：journal 重放 + CMS takeDecisions 查询待决 → 暂停点续跑（resumePendingTurn）
 */
import { join } from "node:path";
import { RPCChannel } from "kkrpc";
import { webSocketClientTransport } from "kkrpc/ws";
import { Conversation, type ManagerWaitChannel } from "../../conversation/server/Conversation.js";
import { FileConversationJournalService } from "../../conversation/persistence/FileConversationJournalService.js";
import { FileConversationJournalReadOnlyService } from "../../conversation/persistence/FileConversationJournalReadOnlyService.js";
import { journalListener } from "../../conversation/JournalBridge.js";
import { debugLog } from "../../log/debug.js";
import { createLogger } from "../../log/pino.js";
import { InMemoryNovelStore } from "../../novel/InMemoryNovelStore.js";
import { NovelHandle } from "../../novel/client/NovelHandle.js";
import { createProvider } from "../../runtime/provider/Provider.js";
import { buildNovelAgent } from "../../runtime/agent/NovelAgent.js";
import type { LLMessage } from "../../runtime/provider/types.js";
import type { AgentRunConfig } from "../../runtime/loop/types.js";
import type { ApprovalQueueItem } from "../../conversation/server/WaitRequestQueue.js";
import type { NovelQuery } from "../../novel/contract/query.js";
import type { NovelMutation } from "../../novel/contract/mutation.js";
import type { OutputEvent } from "../../conversation/contract/events/index.js";

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

/** 由 requestId 尾段解析 toolCallId（requestId = approval_{convId}_{turnSeq}_{toolCallId}） */
function toolCallIdOf(requestId: string): string | undefined {
	const parts = requestId.split("_");
	return parts.length >= 4 ? parts.slice(3).join("_") : undefined;
}

/**
 * 启动 conversation 子进程（manager WS 双工）
 */
export async function runDesktopRuntimeChildEntrypoint(): Promise<void> {
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
		const decisions = await cmsApi.takeDecisions(conversationId).catch(() => []);
		const byToolCallId = new Map<string, ApprovalQueueItem>();
		for (const item of decisions) {
			const toolCallId = toolCallIdOf(item.requestId);
			if (toolCallId !== undefined) byToolCallId.set(toolCallId, item);
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

	const provider = createProvider({
		id: "default",
		type: (process.env.NOVEL_PROVIDER_TYPE as "openai" | "anthropic" | undefined) ?? "openai",
		baseUrl: process.env.NOVEL_PROVIDER_BASE_URL ?? "https://api.deepseek.com/v1",
		apiKey: process.env.NOVEL_PROVIDER_API_KEY,
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
		// 120s 无决策：退出进程（不占资源）；CMS 在 UI 决策后重启续跑
		onWaitTimeout: cmsApi !== undefined ? () => process.exit(0) : undefined,
	});
	holder.conv = conv;

	// 暂停点续跑：恢复 turn 存在缺 tool 结果的 toolCall 时补完并收口
	if (turnMessages !== undefined && turnMessages.length > 0) {
		const hasPendingTool = turnMessages.some(
			(m) => m.role === "assistant" && (m.toolCalls ?? []).length > 0,
		);
		if (hasPendingTool) {
			await loop.resumePendingTurn({ sampling, maxTurns: 8 }).catch((err) => {
				debugLog("[child] resumePendingTurn failed:", err);
			});
		}
	}

	// 报到 CMS（spawner 等待点；此后 manager 侧拿到 conversation handle）
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
	// 子进程驻留：事件循环由 WS 连接与定时器维持
}
