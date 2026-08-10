/**
 * PromptAssemblyBuilder 冒烟（Step 2 of PromptAssembly refactor）。
 * PromptAssemblyBuilder smoke (Step 2 of the PromptAssembly refactor).
 *
 * 验证 / Verifies:
 * 1. systemPrompt 恒等于 basePrompt.content（动态内容不再拼接进 system prompt）；
 * 2. system.reminder 消息随 messages 原样保留（顺序不变、不剥离）；
 * 3. 相同输入 digest 稳定，reminder 内容变化时 digest 变化；
 * 4. 错误路径：会话不匹配、重复消息 ID 拒绝。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  PromptAssemblyBuilder,
  PromptAssemblyError,
  PromptCapabilitySnapshot,
  RuntimePromptAssembler,
  ManifestSystemPromptCompiler,
  createDefaultPromptSectionRegistry,
  novelAgentDefinition,
} from "../dist/index.js";

class Sha256PromptDigester {
  algorithm = "sha256";

  async digest(content) {
    return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
  }
}

const digester = new Sha256PromptDigester();
const promptBuilder = new ManifestSystemPromptCompiler({
  sections: createDefaultPromptSectionRegistry(),
  digester,
});
const basePrompt = await promptBuilder.compile({
  definition: novelAgentDefinition,
  capabilities: new PromptCapabilitySnapshot([{
    name: "TodoWrite",
    version: "1.0.0",
    label: "Todo Write",
    description: "Maintains the current execution plan.",
  }]),
});
const assembler = new RuntimePromptAssembler(new PromptAssemblyBuilder({ digester }));

const userMessage = {
  id: "message:user-1",
  conversationId: "conversation:assembly",
  role: "user",
  messageType: "user.message",
  schemaVersion: 1,
  timestamp: "2026-08-03T00:00:00.000Z",
  runId: "run:1",
  payload: {
    content: [{ type: "text", text: "Hello" }],
  },
};
const reminderMessage = {
  id: "message:reminder-1",
  conversationId: "conversation:assembly",
  role: "system",
  messageType: "system.reminder",
  schemaVersion: 1,
  timestamp: "2026-08-03T00:00:01.000Z",
  runId: "run:1",
  payload: {
    kind: "todo_reminder",
    content: "<CURRENT_TODOS revision=\"2\">\n- [pending] outline\n</CURRENT_TODOS>",
    order: 1,
  },
};

const request = {
  conversationId: "conversation:assembly",
  runId: "run:1",
  basePrompt,
  messages: [userMessage, reminderMessage],
  messageHighWatermark: 2,
};

const assembly = await assembler.assemble(request);
assert.equal(assembly.conversationId, request.conversationId);
assert.equal(assembly.runId, request.runId);
// 1. systemPrompt 只含 base / system prompt is base-only.
assert.equal(assembly.systemPrompt, basePrompt.content);
assert.ok(!assembly.systemPrompt.includes("CURRENT_TODOS"));
// 2. 消息原样保留（含 system.reminder） / messages preserved with the reminder.
assert.equal(assembly.messages.length, 2);
assert.equal(assembly.messages[0].id, userMessage.id);
assert.equal(assembly.messages[1].id, reminderMessage.id);
assert.equal(assembly.messages[1].messageType, "system.reminder");
assert.ok(Object.isFrozen(assembly));
assert.ok(Object.isFrozen(assembly.messages));
assert.ok(Object.isFrozen(assembly.messages[1]));
assert.match(assembly.digest, /^sha256:[0-9a-f]{64}$/);

// 3. 相同输入 digest 稳定；reminder 内容变化时 digest 变化。
const repeatedAssembly = await assembler.assemble(request);
assert.equal(repeatedAssembly.digest, assembly.digest);
const changedAssembly = await assembler.assemble({
  ...request,
  messages: [userMessage, {
    ...reminderMessage,
    payload: { ...reminderMessage.payload, content: "<CURRENT_TODOS revision=\"3\"/>" },
  }],
});
assert.notEqual(changedAssembly.digest, assembly.digest);

// 4. 错误路径 / error paths.
await assert.rejects(
  () => assembler.assemble({
    ...request,
    messages: [{ ...userMessage, conversationId: "conversation:other" }],
  }),
  (error) => {
    assert.ok(error instanceof PromptAssemblyError);
    assert.equal(error.failure, "conversation_mismatch");
    return true;
  },
);

await assert.rejects(
  () => assembler.assemble({
    ...request,
    messages: [userMessage, { ...userMessage, id: "message:user-1" }],
  }),
  (error) => {
    assert.ok(error instanceof PromptAssemblyError);
    assert.equal(error.failure, "duplicate_message");
    return true;
  },
);

console.log("prompt assembly smoke: passed (base-only systemPrompt, reminder preserved)");
