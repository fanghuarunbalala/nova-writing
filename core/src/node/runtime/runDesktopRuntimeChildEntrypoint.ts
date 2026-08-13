/**
 * runDesktopRuntimeChildEntrypoint：conversation 子进程入口。
 * 从 env 读 provider 配置，组装 Conversation + stdio transport。
 * novel 访问：fd 3 可用时经 NovelHandle RPC 到 main 的共享 store；否则回退内存 store。
 */

import { createReadStream, createWriteStream, fstatSync } from "node:fs";
import { join } from "node:path";
import { createStdioTransport } from "../../rpc/transport.js";
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

/** fd 3 是否可用（main 经第二条 stdio 管道暴露 novel） */
function hasNovelFd(): boolean {
	try {
		fstatSync(3);
		return true;
	} catch {
		return false;
	}
}

/**
 * 启动 conversation 子进程（stdio）
 */
export async function runDesktopRuntimeChildEntrypoint(): Promise<void> {
	const conversationId = process.env.CONVERSATION_ID ?? "main";
	const storedir = process.env.NOVEL_CONVERSATION_STOREDIR;
	const workspace = process.env.NOVEL_CONVERSATION_WORKSPACE ?? ".";

	let handle: NovelHandle;
	if (hasNovelFd()) {
		const novelTransport = createStdioTransport({
			readable: createReadStream("", { fd: 3, autoClose: false }),
			writable: createWriteStream("", { fd: 3, autoClose: false }),
		});
		handle = new NovelHandle(novelTransport);
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
		type: "openai",
		baseUrl: process.env.NOVEL_PROVIDER_BASE_URL ?? "https://api.deepseek.com/v1",
		apiKey: process.env.NOVEL_PROVIDER_API_KEY,
	});

	const loop = buildNovelAgent({
		workspace,
		provider,
		handle,
		conversationId,
		listeners: journal !== undefined ? [journalListener(journal)] : undefined,
		turnMessages,
		resumeSeq,
	});
	const conversation = new Conversation({
		conversationId,
		loop,
		sampling: {
			model: process.env.NOVEL_PROVIDER_MODEL ?? "deepseek-v4-flash",
			maxTokens: 512,
			thinking: "high",
		},
	});

	const transport = createStdioTransport({ readable: process.stdin, writable: process.stdout });
	await runConversation(conversation, transport);
	process.stdin.on("end", () => process.exit(0));
}
