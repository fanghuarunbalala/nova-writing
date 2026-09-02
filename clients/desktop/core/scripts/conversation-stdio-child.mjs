// conversation 子进程：stdio transport + expose Conversation（spawn 目标）。
// 装配：buildNovelAgent（deepseek provider + 内存 novel store）+ Conversation。
import { createStdioTransport } from "../dist/rpc/transport.js";
import { runConversation } from "../dist/init/ConversationInit.js";
import { Conversation } from "../dist/conversation/server/Conversation.js";
import { buildNovelAgent } from "../dist/runtime/agent/NovelAgent.js";
import { InMemoryNovelStore } from "../dist/novel/InMemoryNovelStore.js";
import { createProvider } from "../dist/runtime/provider/Provider.js";

const conversationId = process.env.CONVERSATION_ID || "main";
const agentId = process.env.AGENT_ID || "main";

// novel 内存 store（子进程独立实例）
const store = new InMemoryNovelStore();
const handle = { query: (q) => store.query(q), mutate: (m) => store.mutate(m) };

// provider（deepseek，key 从环境变量）
const provider = createProvider({
  id: "deepseek",
  type: "openai",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
});

const loop = buildNovelAgent({ workspace: ".", provider, handle });
const conversation = new Conversation({
  conversationId,
  loop,
  sampling: { model: "deepseek-v4-flash", maxTokens: 512, thinking: "high" },
});

const transport = createStdioTransport({
  readable: process.stdin,
  writable: process.stdout,
});
await runConversation(conversation, transport);
console.error(`[child] conversation ${conversationId} ready (agent=${agentId})`);
process.stdin.on("end", () => process.exit(0));
