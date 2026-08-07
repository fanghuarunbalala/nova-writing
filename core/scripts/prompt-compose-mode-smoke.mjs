/**
 * Compose 提示层冒烟：动态段按 compose 状态渲染，RuntimeSystemPromptBuilder 空段跳过。
 * Smoke for the compose prompt layer: the dynamic section renders by compose
 * state, and RuntimeSystemPromptBuilder skips empty blocks.
 */
import assert from "node:assert/strict";
import {
  DynamicPromptSection,
  NovelComposeModePromptSection,
  RuntimeSystemPromptBuilder,
  createDefaultPromptSectionRegistry,
} from "../dist/index.js";

const registry = createDefaultPromptSectionRegistry();
const section = registry.resolve("novel.compose");
assert.ok(section instanceof NovelComposeModePromptSection);
assert.ok(section instanceof DynamicPromptSection);
assert.equal(section.kind, "dynamic");
assert.equal(section.render(), "");

// 按输入状态渲染：非活动/已结束为空，designing/pending 有内容。
assert.equal(section.renderDynamic({}), "");
assert.equal(
  section.renderDynamic({ compose: { phase: "applied", active: false } }),
  "",
);
assert.equal(
  section.renderDynamic({ compose: { phase: "discarded", active: false } }),
  "",
);
const designing = section.renderDynamic({
  compose: { phase: "designing", active: true },
});
assert.ok(designing.includes("设计模式"));
assert.ok(designing.includes("ExitComposeMode"));
const pending = section.renderDynamic({
  compose: { phase: "pending", active: true },
});
assert.ok(pending.includes("等待作者审批"));

// RuntimeSystemPromptBuilder：活动时附加、非活动时跳过（base 不变）。
const staticSource = {
  async resolve() {
    return { content: "BASE_PROMPT", digest: "base-digest" };
  },
};
const digester = {
  async digest(content) {
    return `digest:${content.length}`;
  },
};
const builder = new RuntimeSystemPromptBuilder({
  staticSource,
  dynamicSections: [section],
  input: async () => ({
    compose: { phase: "designing", active: true },
  }),
  digester,
});
const composed = await builder.resolve({ conversationId: "c", runId: "r" });
assert.ok(composed.content.includes("设计模式"));
assert.ok(composed.content.startsWith("BASE_PROMPT"));

const idleBuilder = new RuntimeSystemPromptBuilder({
  staticSource,
  dynamicSections: [section],
  input: async () => ({}),
  digester,
});
const idle = await idleBuilder.resolve({ conversationId: "c", runId: "r" });
assert.equal(idle.content, "BASE_PROMPT");

console.log("prompt compose mode smoke passed");
