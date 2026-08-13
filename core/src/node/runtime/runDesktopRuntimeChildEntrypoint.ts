/**
 * runDesktopRuntimeChildEntrypoint：conversation 子进程入口。
 * 从 env 读 provider 配置，组装 Conversation + stdio transport。
 * （provider 配置由 zygote 注入 env；config 域落地后改经 config 传递）
 */

import { createStdioTransport } from "../../rpc/transport.js";
import { Conversation } from "../../conversation/server/Conversation.js";
import { runConversation } from "../../init/ConversationInit.js";
import { InMemoryNovelStore } from "../../novel/InMemoryNovelStore.js";
import { createProvider } from "../../runtime/provider/Provider.js";
import { buildNovelAgent } from "../../runtime/agent/NovelAgent.js";
import type { NovelHandle } from "../../novel/client/NovelHandle.js";
import type { NovelQuery } from "../../novel/contract/query.js";
import type { NovelMutation } from "../../novel/contract/mutation.js";

/**
 * 启动 conversation 子进程（stdio）
 */
export async function runDesktopRuntimeChildEntrypoint(): Promise<void> {
	const conversationId = process.env.CONVERSATION_ID ?? "main";
	const store = new InMemoryNovelStore();
	const handle = {
		query: (q: NovelQuery) => store.query(q),
		mutate: (m: NovelMutation) => store.mutate(m),
	} as unknown as NovelHandle;

	const provider = createProvider({
		id: "default",
		type: "openai",
		baseUrl: process.env.NOVEL_PROVIDER_BASE_URL ?? "https://api.deepseek.com/v1",
		apiKey: process.env.NOVEL_PROVIDER_API_KEY,
	});

	const loop = buildNovelAgent({ workspace: ".", provider, handle });
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
