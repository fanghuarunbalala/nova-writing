/**
 * 环境信息动态段 + 静态/动态编译解析冒烟。
 * Environment dynamic-section and static/dynamic compile-resolve smoke.
 *
 * 验证 / Verifies:
 * 1. CoreEnvironmentPromptSection.renderDynamic 输出恒定格式，render() 编译期为空；
 * 2. ManifestSystemPromptCompiler.compile 只编译静态段（不含环境块），
 *    且“静态在动态之后”会抛错；
 * 3. RuntimeSystemPromptBuilder.resolve 把静态 base 与动态段拼接，重算 digest，
 *    无动态段时原样返回静态 base。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  AgentCommunicationPolicy,
  AgentDelegationPolicy,
  AgentDefinition,
  AgentToolPolicy,
  CoreEnvironmentPromptSection,
  ManifestSystemPromptCompiler,
  PromptCapabilitySnapshot,
  PromptRecipe,
  PromptSectionItem,
  RuntimeSystemPromptBuilder,
  createDefaultPromptSectionRegistry,
  novelAgentDefinition,
  renderEnvironmentOverlay,
} from "../dist/index.js";

const digester = {
  algorithm: "sha256",
  async digest(content) {
    return `sha256:${createHash("sha256").update(content).digest("hex")}`;
  },
};

const registry = createDefaultPromptSectionRegistry();
const environment = new CoreEnvironmentPromptSection();

// 1. 动态段渲染：有输入时输出整块；无输入/编译期为空。
const rendered = environment.renderDynamic({
  environment: {
    workdir: "/tmp/novel-workspace",
    platform: "macOS",
    modelId: "gpt-test-model",
  },
});
assert.ok(rendered.startsWith("# 环境信息"));
assert.ok(rendered.includes("- 平台：macOS"));
assert.ok(rendered.includes("- 模型：gpt-test-model"));
// 工作目录行已按 4012d9f 有意移除（模型文件工具沙盒到 workspace 相对路径，绝对路径不可用）。
assert.ok(!rendered.includes("- 工作目录"));
assert.equal(environment.render(), "");
assert.equal(
  environment.renderDynamic({ environment: undefined }),
  "",
);

// 2. Manifest 编译只含静态段；动态段不进 base。
const capabilities = new PromptCapabilitySnapshot([]);
const compiler = new ManifestSystemPromptCompiler({
  sections: registry,
  digester,
});
const compiled = await compiler.compile({
  definition: novelAgentDefinition,
  capabilities,
});
assert.ok(compiled.content.includes("# 身份与创作定位"));
assert.ok(!compiled.content.includes("# 环境信息"));
assert.equal(compiled.blocks.some((block) => block.sourceId === "core.environment"), false);

// 静态在动态之后必须报错。
const invalidDefinition = new AgentDefinition({
  agentType: "invalid_order",
  definitionVersion: "1.0.0",
  label: "Invalid Order",
  description: "Static section after dynamic section must fail.",
  promptRecipe: new PromptRecipe([
    new PromptSectionItem("core.environment"),
    new PromptSectionItem("novel.identity"),
  ]),
  tools: new AgentToolPolicy({ groupIds: ["runtime.todo"] }),
  delegation: new AgentDelegationPolicy({
    mode: "disabled",
    allowedAgentTypes: [],
  }),
  communication: new AgentCommunicationPolicy("standalone"),
  runtimePolicyId: "default",
});
await assert.rejects(
  compiler.compile({ definition: invalidDefinition, capabilities }),
  /Static Prompt Section must precede dynamic sections/,
);

// 3. Runtime resolve：静态 base + 动态段拼接，digest 重算。
const staticBase = Object.freeze({
  content: "STATIC BASE",
  digest: await digester.digest("STATIC BASE"),
});
const runtimeBuilder = new RuntimeSystemPromptBuilder({
  staticSource: { async resolve() { return staticBase; } },
  dynamicSections: [environment],
  input: async () => ({
    environment: {
      workdir: "/tmp/novel-workspace",
      platform: "macOS",
    },
  }),
  digester,
});
const resolved = await runtimeBuilder.resolve({
  conversationId: "conversation_env_smoke",
  runId: "run_env_smoke",
});
assert.ok(resolved.content.startsWith("STATIC BASE"));
assert.ok(resolved.content.includes("# 环境信息"));
assert.notEqual(resolved.digest, staticBase.digest);

const plainBuilder = new RuntimeSystemPromptBuilder({
  staticSource: { async resolve() { return staticBase; } },
  dynamicSections: [],
  input: async () => ({}),
  digester,
});
const plainResolved = await plainBuilder.resolve({
  conversationId: "conversation_env_smoke",
  runId: "run_env_smoke",
});
assert.equal(plainResolved.content, staticBase.content);
assert.equal(plainResolved.digest, staticBase.digest);

console.log(
  "runtime-environment-overlay: ok (dynamic section + manifest compile + runtime resolve)",
);
