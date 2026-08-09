/**
 * 小说全局约束动态段冒烟：常驻说明 + NOVEL.md 内容（标签包裹）注入 system prompt。
 * Novel global-constraints dynamic-section smoke: standing instructions plus the
 * tag-wrapped NOVEL.md content injected into the system prompt per call.
 *
 * 验证 / Verifies:
 * 1. 注册表解析出 novel.global_constraints 且为动态段；
 * 2. Manifest 编译产物不含该块（动态段不进 base，文件改动不破坏 digest）；
 * 3. RuntimeSystemPromptBuilder 带 novelGlobalConstraints 输入 → resolve()
 *    输出含常驻说明、标签包裹的文件内容、digest 重算；
 * 4. 无输入 → 常驻说明仍渲染（只依赖 workspace 与 NOVEL.md 位置），标签内为
 *    无内容占位，digest 与静态 base 不同。
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

// 3. Runtime resolve：带 novelGlobalConstraints 输入时输出含常驻说明 + 标签包裹内容。
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
assert.ok(injected.content.includes("# 小说全局约束（NOVEL.md）"));
assert.ok(injected.content.includes("每次 Provider Call 都会重新读取"));
assert.ok(injected.content.includes("此文件仅记录小说 meta/全局约束"));
assert.ok(injected.content.includes("<Novel-Constraints-Content>"));
assert.ok(injected.content.includes("本作基调为热血战斗。"));
assert.ok(injected.content.includes("</Novel-Constraints-Content>"));
assert.notEqual(injected.digest, staticBase.digest);

// 4. 无输入 → 常驻说明仍渲染（只依赖 workspace 与 NOVEL.md 位置），标签内为占位。
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
assert.ok(plainResolved.content.startsWith("STATIC BASE"));
assert.ok(plainResolved.content.includes("# 小说全局约束（NOVEL.md）"));
assert.ok(plainResolved.content.includes("每次 Provider Call 都会重新读取"));
assert.ok(plainResolved.content.includes("<Novel-Constraints-Content>"));
assert.ok(plainResolved.content.includes("（当前无可用内容"));
assert.ok(plainResolved.content.includes("</Novel-Constraints-Content>"));
assert.notEqual(plainResolved.digest, staticBase.digest);

console.log("novel-global-constraints: ok (dynamic section injects project NOVEL.md per call)");
