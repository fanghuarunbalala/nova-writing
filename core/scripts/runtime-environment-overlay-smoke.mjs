/**
 * 环境信息块冒烟。
 * Environment-info overlay smoke.
 *
 * 验证 / Verifies:
 * 1. renderEnvironmentOverlay 输出恒定格式（日期/时区/平台/模型/工作目录）；
 * 2. 模型解析失败（无 modelId）时省略模型行；
 * 3. appendEnvironmentOverlay 对空 base 与非空 base 的拼接；
 * 4. PromptAssemblyBuilder 注入环境块后 systemPrompt 包含 overlay，digest
 *    随内容变化，消息不变。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  PromptAssemblyBuilder,
  appendEnvironmentOverlay,
  renderEnvironmentOverlay,
} from "../dist/index.js";

const SNAPSHOT = Object.freeze({
  timezone: "Asia/Shanghai",
  date: "2026-08-07",
  platform: "macOS",
  modelId: "gpt-test-model",
  workdir: "/tmp/novel-workspace",
});

const overlay = renderEnvironmentOverlay(SNAPSHOT);
assert.ok(overlay.startsWith("# 环境信息"));
assert.ok(overlay.includes("- 当前日期：2026-08-07（Asia/Shanghai）"));
assert.ok(overlay.includes("- 平台：macOS"));
assert.ok(overlay.includes("- 模型：gpt-test-model"));
assert.ok(overlay.includes("- 工作目录：/tmp/novel-workspace"));

const noModel = renderEnvironmentOverlay({
  ...SNAPSHOT,
  modelId: undefined,
});
assert.ok(!noModel.includes("- 模型："));
assert.equal(renderEnvironmentOverlay(SNAPSHOT), overlay);

const appended = appendEnvironmentOverlay("BASE PROMPT", SNAPSHOT);
assert.ok(appended.startsWith("BASE PROMPT"));
assert.ok(appended.includes(`\n\n${overlay}`));
assert.equal(appendEnvironmentOverlay("", SNAPSHOT), overlay);

const digester = {
  algorithm: "sha256",
  async digest(content) {
    return `sha256:${createHash("sha256").update(content).digest("hex")}`;
  },
};
const baseContent = "BASE PROMPT";
const baseDigest = await digester.digest(baseContent);
const builder = new PromptAssemblyBuilder({
  digester,
  environmentInfo: {
    async snapshot() {
      return SNAPSHOT;
    },
  },
});
const assembly = await builder.build({
  conversationId: "conversation_env_smoke",
  runId: "run_env_smoke",
  basePrompt: { content: baseContent, digest: baseDigest },
  messages: [],
  messageHighWatermark: 0,
});
assert.ok(assembly.systemPrompt.includes("# 环境信息"));
assert.ok(assembly.systemPrompt.startsWith(baseContent));
assert.notEqual(assembly.digest, baseDigest);
assert.deepEqual(assembly.messages, []);

const plainBuilder = new PromptAssemblyBuilder({ digester });
const plainAssembly = await plainBuilder.build({
  conversationId: "conversation_env_smoke",
  runId: "run_env_smoke",
  basePrompt: { content: baseContent, digest: baseDigest },
  messages: [],
  messageHighWatermark: 0,
});
assert.equal(plainAssembly.systemPrompt, baseContent);

console.log(
  "runtime-environment-overlay: ok (render + append + builder injection stable)",
);
