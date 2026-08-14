// teammate smoke：manager（内存）spawn teammate（进程）→ 跨进程 sendMessageTo → journal 落盘断言 → terminate kill
// 子进程 = desktop-child.mjs（生产入口 runDesktopRuntimeChildEntrypoint：journal + subagent 接线）
// 运行：NOVEL_PROVIDER_API_KEY=... node core/scripts/conversation-teammate-smoke.mjs（需 build）
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ConversationManagerServer } from "../dist/conversation/server/ConversationManagerServer.js";
import { Conversation } from "../dist/conversation/server/Conversation.js";
import { createProcessSpawner } from "../dist/init/ProcessSpawner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const childScript = join(__dirname, "desktop-child.mjs");
const storedirRoot = mkdtempSync(join(tmpdir(), "teammate-"));

// manager：内存 factory（测试）+ 进程 spawner（生产）+ storedirRoot（生产路径：storedir 分配/journal 落盘）
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
  { storedirRoot },
);

console.log("=== teammate 进程派生 smoke ===");
const ref = await server.spawnConversation({ agentType: "novel", parentId: "root-1" });
console.log("spawned teammate:", ref.conversationId);

await new Promise((r) => setTimeout(r, 800)); // 等子进程起好

// 跨进程发消息（真实 deepseek）
const receipt = await server.sendMessageTo(ref.conversationId, { text: "写一句深秋开头。" });
console.log("sendMessageTo 回执:", JSON.stringify(receipt));

// 等子进程 journal 落盘（生产链路：entrypoint journal open + journalListener + 消息流事件持久化）
const journalPath = join(storedirRoot, ref.conversationId, "journal.jsonl");
let journalOk = false;
for (let i = 0; i < 100 && !journalOk; i++) {
  if (existsSync(journalPath)) {
    const content = readFileSync(journalPath, "utf8");
    // journal 行 = {seq, turn} 快照（FileConversationJournalService），断言消息角色而非事件类型
    journalOk = content.includes('"role":"user"') && content.includes('"role":"assistant"');
  }
  if (!journalOk) await new Promise((r) => setTimeout(r, 300));
}
console.log("journal 落盘（user+assistant 消息）:", journalOk, journalPath);

const list = await server.list();
console.log("会话数:", list.length, "状态:", list[0].status);

await server.terminate(ref.conversationId);
console.log("terminate 后状态:", (await server.list())[0]?.status);

if (!journalOk) {
  console.error("SMOKE FAIL: journal 未落盘");
  process.exit(1);
}
console.log("SMOKE OK");
