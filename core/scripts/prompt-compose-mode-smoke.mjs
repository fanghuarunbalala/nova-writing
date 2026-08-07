/**
 * Compose 提示层冒烟：静态段注册 + overlay/reminder 文案随状态变化。
 * Smoke for the compose prompt layer: section registration plus state-driven overlay/reminder text.
 */
import assert from "node:assert/strict";
import {
  ComposeAwareRuntimeSystemPromptSource,
  ComposeModeStateProvider,
  ComposePromptContributor,
  createDefaultPromptSectionRegistry,
} from "../dist/index.js";

// 静态段已注册且可解析
const registry = createDefaultPromptSectionRegistry();
const composeSection = registry.resolve("novel.compose");
assert.ok(composeSection.render().includes("设计模式"));
assert.ok(composeSection.render().includes("ExitComposeMode"));

// 状态驱动 overlay
const state = new ComposeModeStateProvider();
const contributor = new ComposePromptContributor(state);
const conversationId = "conversation:prompt-compose";

assert.equal(await contributor.append(conversationId, "BASE"), "BASE");

state.enter(conversationId, {
  designFilePath: "/workspace/.novel/design/conversation-prompt-compose.md",
});
const designing = await contributor.append(conversationId, "BASE");
assert.ok(designing.includes("设计模式"));
assert.ok(designing.startsWith("BASE"));

state.submit(conversationId);
const pending = await contributor.append(conversationId, "BASE");
assert.ok(pending.includes("等待作者审批"));

state.approve(conversationId);
assert.equal(await contributor.append(conversationId, "BASE"), "BASE");

// reminder 草稿：designing 有 compose_reminder；idle 无
const reminderInput = {
  conversationId,
  runId: "run-1",
  reminderId: "reminder-1",
  order: 1,
  timestamp: "2026-08-07T00:00:00.000Z",
};
assert.equal(
  contributor.buildReminderMessage(reminderInput, state.snapshot(conversationId)),
  null,
);
state.enter(conversationId, {
  designFilePath: "/workspace/.novel/design/conversation-prompt-compose.md",
});
const draft = contributor.buildReminderMessage(
  reminderInput,
  state.snapshot(conversationId),
);
assert.equal(draft.payload.kind, "compose_reminder");
assert.equal(draft.role, "system");

// SystemPrompt 源包装：激活时附加、批准后恢复
const baseSource = {
  async resolve() {
    return "BASE_PROMPT";
  },
};
const aware = new ComposeAwareRuntimeSystemPromptSource(baseSource, state);
const request = { conversationId, runId: "run-1" };
const composed = await aware.resolve(request);
assert.ok(composed.includes("设计模式"));
state.approve(conversationId);
assert.equal(await aware.resolve(request), "BASE_PROMPT");

console.log("prompt compose mode smoke passed");
