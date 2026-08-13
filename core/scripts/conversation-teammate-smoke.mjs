// teammate smoke：manager（内存）spawn teammate（进程）→ 跨进程 sendMessageTo → terminate kill
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ConversationManagerServer } from "../dist/conversation/server/ConversationManagerServer.js";
import { Conversation } from "../dist/conversation/server/Conversation.js";
import { createProcessSpawner } from "../dist/init/ProcessSpawner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const childScript = join(__dirname, "conversation-stdio-child.mjs");

// manager：内存 factory（测试）+ 进程 spawner（生产）
const server = new ConversationManagerServer(
  {
    create: (opts) =>
      new Conversation({
        conversationId: opts.conversationId,
        loop: { run: async () => ({ final: { role: "assistant", content: "内存" }, usage: undefined }), followup: () => {}, steer: () => {}, stop: () => {}, cancel: () => {}, onOutputEvent: () => () => {} },
        sampling: { model: "gpt-5" },
      }),
  },
  createProcessSpawner(childScript),
);

console.log("=== teammate 进程派生 smoke ===");
const ref = await server.spawnConversation({ agentType: "novel", parentId: "root-1" });
console.log("spawned teammate:", ref.conversationId);

await new Promise((r) => setTimeout(r, 800)); // 等子进程起好

// 跨进程发消息（真实 deepseek）
const receipt = await server.sendMessageTo(ref.conversationId, { text: "写一句深秋开头。" });
console.log("sendMessageTo 回执:", JSON.stringify(receipt));

const list = await server.list();
console.log("会话数:", list.length, "状态:", list[0].status);

await server.terminate(ref.conversationId);
console.log("terminate 后状态:", (await server.list())[0]?.status);
console.log("SMOKE OK");
