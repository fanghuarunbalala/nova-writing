/**
 * 小说全局约束动态段冒烟：NOVEL.md 每次调用注入 system prompt。
 * Novel global-constraints dynamic-section smoke: project NOVEL.md injected
 * into the system prompt per call.
 *
 * 验证 / Verifies:
 * 1. 注册表解析出 novel.global_constraints 且为动态段；
 * 2. Manifest 编译产物不含该块（动态段不进 base，文件改动不破坏 digest）；
 * 3. RuntimeSystemPromptBuilder 带 novelGlobalConstraints 输入 → resolve()
 *    输出含文件内容、digest 重算；
 * 4. 无输入 → 输出不含该块、digest 与静态 base 一致。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  AgentCommunicationPolicy,
  AgentDelegationPolicy,
  AgentDefinition,
  AgentToolPolicy,
  ManifestSystemPromptCompiler,
  PromptCapabilitySnapshot,
  PromptRecipe,
  PromptSectionItem,
  RuntimeSystemPromptBuilder,
  createDefaultPromptSectionRegistry,
  novelAgentDefinition,
} from "../dist/index.js";

const digester = {
  algorithm: "sha256",
  async digest(content) {
    return `sha256:${createHash("sha256").update(content).digest("hex")}`;
  },
};

const registry = createDefaultPromptSectionRegistry();

// 1. 注册表可解析 novel.global_constraints 且为动态段。
const resolved = registry.resolve("novel.global_constraints");
assert.equal(resolved.kind, "dynamic");
assert.equal(resolved.id, "novel.global_constraints");

// 2. Manifest 编译只含静态段；动态段（含约束块）不进 base。
const compiler = new ManifestSystemPromptCompiler({
  sections: registry,
  digester,
});
const compiled = await compiler.compile({
  definition: novelAgentDefinition,
  capabilities: new PromptCapabilitySnapshot([]),
});
assert.ok(!compiled.content.includes("小说全局约束"));
assert.equal(
  compiled.blocks.some((block) => block.sourceId === "novel.global_constraints"),
  false,
);

// 3. Runtime resolve：带 novelGlobalConstraints 输入时输出含文件内容。
const constraintsContent = "# 世界观\n- 本作基调为热血战斗。\n- 禁止主角死亡。";
const staticBase = Object.freeze({
  content: "STATIC BASE",
  digest: await digester.digest("STATIC BASE"),
});
const injectedBuilder = new RuntimeSystemPromptBuilder({
  staticSource: { async resolve() { return staticBase; } },
  dynamicSections: [resolved],
  input: async () => ({
    novelGlobalConstraints: {
      fileName: "NOVEL.md",
      content: constraintsContent,
    },
  }),
  digester,
});
const injected = await injectedBuilder.resolve({
  conversationId: "conversation_constraints_smoke",
  runId: "run_constraints_smoke",
});
assert.ok(injected.content.startsWith("STATIC BASE"));
assert.ok(injected.content.includes("小说全局约束（NOVEL.md）"));
assert.ok(injected.content.includes("本作基调为热血战斗。"));
assert.ok(injected.content.includes("此文件仅记录小说 meta/全局约束"));
assert.notEqual(injected.digest, staticBase.digest);

// 4. 无输入 → 输出不含约束块、digest 与 base 一致。
const plainBuilder = new RuntimeSystemPromptBuilder({
  staticSource: { async resolve() { return staticBase; } },
  dynamicSections: [resolved],
  input: async () => ({}),
  digester,
});
const plainResolved = await plainBuilder.resolve({
  conversationId: "conversation_constraints_smoke",
  runId: "run_constraints_smoke",
});
assert.equal(plainResolved.content, staticBase.content);
assert.equal(plainResolved.digest, staticBase.digest);

console.log("novel-global-constraints: ok (dynamic section injects project NOVEL.md per call)");
