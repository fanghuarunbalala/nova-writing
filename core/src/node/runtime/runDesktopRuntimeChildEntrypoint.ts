/**
 * runDesktopRuntimeChildEntrypoint：conversation 子进程入口。
 * 从 env 读 provider 配置，组装 Conversation + stdio transport。
 * novel 访问：fd 3 可用时经 NovelHandle RPC 到 main 的共享 store；否则回退内存 store。
 */

import { join } from "node:path";
import { createStdioTransport } from "../../rpc/transport.js";
import { webSocketClientTransport } from "kkrpc/ws";
import { Conversation } from "../../conversation/server/Conversation.js";
import { FileConversationJournalService } from "../../conversation/persistence/FileConversationJournalService.js";
import { FileConversationJournalReadOnlyService } from "../../conversation/persistence/FileConversationJournalReadOnlyService.js";
import { journalListener } from "../../conversation/JournalBridge.js";
import { runConversation } from "../../init/ConversationInit.js";
import { InMemoryNovelStore } from "../../novel/InMemoryNovelStore.js";
import { NovelHandle } from "../../novel/client/NovelHandle.js";
import { createProvider } from "../../runtime/provider/Provider.js";
import { buildNovelAgent } from "../../runtime/agent/NovelAgent.js";
import type { LLMessage } from "../../runtime/provider/types.js";
import type { NovelQuery } from "../../novel/contract/query.js";
import type { NovelMutation } from "../../novel/contract/mutation.js";

/**
 * 启动 conversation 子进程（stdio）
 */
export async function runDesktopRuntimeChildEntrypoint(): Promise<void> {
	const conversationId = process.env.CONVERSATION_ID ?? "main";
	const storedir = process.env.NOVEL_CONVERSATION_STOREDIR;
	const workspace = process.env.NOVEL_CONVERSATION_WORKSPACE ?? ".";

	// novel-db：经 kkrpc/ws 连接 main 的 NovelDbWsServer（协议定稿 transport；token 走 subprotocol）。
	// 无 NOVEL_DB_WS_URL（独立脚本/开发）回退进程内内存 store。
	let handle: NovelHandle;
	const wsUrl = process.env.NOVEL_DB_WS_URL;
	if (wsUrl !== undefined && wsUrl.trim() !== "") {
		const wsToken = process.env.NOVEL_DB_WS_TOKEN;
		const wsTransport = webSocketClientTransport({
			url: wsUrl,
			protocols: wsToken !== undefined && wsToken !== "" ? [wsToken] : undefined,
		});
		handle = new NovelHandle(wsTransport);
	} else {
		const store = new InMemoryNovelStore();
		handle = {
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

	const provider = createProvider({
		id: "default",
		type: (process.env.NOVEL_PROVIDER_TYPE as "openai" | "anthropic" | undefined) ?? "openai",
		baseUrl: process.env.NOVEL_PROVIDER_BASE_URL ?? "https://api.deepseek.com/v1",
		apiKey: process.env.NOVEL_PROVIDER_API_KEY,
	});

	// 审批通道 late-bound self-reference：loop 的 requestApproval 闭包调 conv.sendApprovalRequest
	// （阻塞到 UI 决策；conv 在 loop 之后构造，故用 holder）
	let conv: Conversation | undefined;
	const loop = buildNovelAgent({
		workspace,
		provider,
		handle,
		conversationId,
		listeners: journal !== undefined ? [journalListener(journal)] : undefined,
		turnMessages,
		resumeSeq,
		requestApproval: (req) => conv!.sendApprovalRequest(req),
	});
	conv = new Conversation({
		conversationId,
		loop,
		sampling: {
			model: process.env.NOVEL_PROVIDER_MODEL ?? "deepseek-v4-flash",
			maxTokens: 512,
			thinking: "high",
		},
		journal,
	});

	const transport = createStdioTransport({ readable: process.stdin, writable: process.stdout });
	await runConversation(conv!, transport);
	process.stdin.on("end", () => process.exit(0));
}
