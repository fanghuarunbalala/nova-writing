// Journal smoke：main 会话 attach journalListener → 跑 AgentLoop → 读 history 返回 OutputEvent
// 运行：node core/scripts/journal-smoke.mjs（需 build，且设置 ANTHROPIC_AUTH_TOKEN）

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentLoop,
  InMemoryRegistry,
  createProvider,
} from "../dist/index.js";
import { FileConversationJournalService } from "../dist/conversation/persistence/index.js";
import { FileConversationJournalReadOnlyService } from "../dist/conversation/persistence/index.js";
import { journalListener } from "../dist/conversation/JournalBridge.js";

// 能力（无工具，纯对话）
const registry = new InMemoryRegistry();
registry.registerAgent({
  agentType: "writer",
  agentVersion: "1",
  label: "Writer",
  description: "小说创作助手（smoke 用）",
  promptIds: ["base"],
});
registry.registerPrompt({ kind: "static", render: () => "你是小说创作助手。" }, "base", "1");
const capability = registry.buildCapability("writer", "1");

// provider
const provider = createProvider({
  id: "deepseek",
  type: "openai",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
});

// journal（main 会话）
const dir = mkdtempSync(join(tmpdir(), "journal-"));
const journal = new FileConversationJournalService({ conversationId: "main", filePath: join(dir, "main", "journal.jsonl") });
await journal.open();

const loop = new AgentLoop({
  workspace: ".",
  provider,
  agentCapability: capability,
  toolDispatcher: { dispatch: async () => "noop" },
  conversationId: "main",
  agentId: "main",
  listeners: [journalListener(journal)],
});

const sampling = { model: "deepseek-v4-flash", maxTokens: 256, thinking: "high" };

// 多轮（每轮追加更新当前 turn）
await loop.run("第一句：秋夜。", { sampling });
await loop.run("继续写第二句。", { sampling });

// 读侧（进程无关：新建实例读文件）
const ro = new FileConversationJournalReadOnlyService({ journalDir: dir });
const events = await ro.history("main", {});

console.log("=== journal.jsonl 已落盘 turns ===");
console.log("history 事件类型序列：", events.map((e) => e.type).join(" → "));
console.log("turn 数：", events.filter((e) => e.type === "turn-start").length);
console.log("含 delta？", events.some((e) => e.type === "assistant.delta"));
console.log("最后一条 user.message 文本：", events.filter((e) => e.type === "user.message").at(-1)?.text);
console.log("journal 文件：", join(dir, "main", "journal.jsonl"));
