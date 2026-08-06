/**
 * Context 投影保留 system.reminder 冒烟（Step 5 of PromptAssembly refactor）。
 * Context-projection system.reminder retention smoke (Step 5 of the PromptAssembly refactor).
 *
 * 验证 / Verifies: 即使 reminder 消息不在 pinned/recent 窗口内，投影结果仍保留它
 * （reminder 永不删除，保消息前缀 → prefill 缓存）。
 */
import assert from "node:assert/strict";
import {
  ContextProjectionProviderCallCoordinator,
  coreRuntimeMessageSchemaRegistry,
} from "../dist/index.js";

const conversationId = "conversation:projection-reminder";
const runId = "run:1";
const providerCallId = "provider-call:1";

function userMessage(id, text) {
  return {
    id,
    conversationId,
    role: "user",
    messageType: "user.message",
    schemaVersion: 1,
    timestamp: "2026-08-06T00:00:00.000Z",
    runId,
    payload: { content: [{ type: "text", text }] },
  };
}

const reminderMessage = {
  id: "message:reminder-todo",
  conversationId,
  role: "system",
  messageType: "system.reminder",
  schemaVersion: 1,
  timestamp: "2026-08-06T00:00:01.000Z",
  runId,
  payload: {
    kind: "todo_reminder",
    content: "<CURRENT_TODOS revision=\"1\"/>",
    order: 1,
  },
};

const canonicalMessages = [
  userMessage("message-old-1", "old one"),
  reminderMessage,
  userMessage("message-old-2", "old two"),
];
for (const message of canonicalMessages) {
  coreRuntimeMessageSchemaRegistry.validateSnapshot(message);
}

const coordinator = new ContextProjectionProviderCallCoordinator({
  candidateProvider: {
    async load(request) {
      return {
        conversationId: request.conversationId,
        providerCallId: request.providerCallId,
        pinnedGroups: [],
        // reminder 不在 recent 窗口内：若没有强制保留，会被投影丢弃。
        recentMessageIds: ["message-old-1", "message-old-2"],
        transientMessageCount: request.transientMessageCount,
        nonMessageFixedTokens: 100,
        checkpointBaseTokens: 0,
        checkpointItemTokenEstimates: [],
        messageTokenEstimates: [
          { messageId: "message-old-1", tokenEstimate: 60 },
          { messageId: "message-old-2", tokenEstimate: 60 },
        ],
        transientMessageTokens: 0,
        hardAdmissionTokens: 400,
      };
    },
  },
});

const result = await coordinator.prepare({
  conversationId,
  runId,
  providerCallId,
  baseSystemPrompt: "base",
  canonicalMessages,
  transientMessageCount: 0,
});

const projectedIds = result.context.messages.map((message) => message.id);
assert.ok(projectedIds.includes("message:reminder-todo"), "reminder 必须被保留");
assert.ok(projectedIds.includes("message-old-1"));
assert.ok(projectedIds.includes("message-old-2"));
assert.equal(result.context.systemPrompt, "base", "systemPrompt 保持 base");

console.log("runtime-context-projection-reminder: ok (reminder retained outside window)");
