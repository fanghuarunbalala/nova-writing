// manager 侧 smoke：spawn conversation 子进程 + stdio wrap handle + sendMessageTo
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { wrap } from "kkrpc";
import { createStdioTransport } from "../dist/rpc/transport.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [join(__dirname, "conversation-stdio-child.mjs")], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, CONVERSATION_ID: "conv-1", AGENT_ID: "main" },
});
const transport = createStdioTransport({ readable: child.stdout, writable: child.stdin });

// wrap 子进程暴露的 Conversation（ConversationInteraction + events + dispose）
const handle = wrap(transport);

await new Promise((r) => setTimeout(r, 800)); // 等 child 起好

console.log("=== spawn conversation 进程化 smoke ===");
const receipt = await handle.sendSystemControl({ type: "mode.set", mode: "bypass" });
console.log("mode.set 回执:", JSON.stringify(receipt));
console.log("conversationMode（内存 activeMode，尚未生效）:", handle.conversationMode);

// 真实发一条消息（会调 deepseek）
const r2 = await handle.sendUserMessage({ text: "写一句深秋开头。" });
console.log("sendUserMessage 回执:", JSON.stringify(r2));

child.kill();
console.log("SMOKE OK");
