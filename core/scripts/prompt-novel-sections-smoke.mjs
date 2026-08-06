/**
 * Novel 创作域 Prompt Section 冒烟。
 * Novel-domain prompt section smoke.
 *
 * 验证 / Verifies:
 * 1. novel.identity 已注册进默认 registry 且可解析；
 * 2. render() 输出包含关键标记（身份、创作边界、不臆造设定）；
 * 3. 相同输入输出恒定（逐字稳定）。
 */
import assert from "node:assert/strict";
import {
  createDefaultPromptSectionRegistry,
} from "../dist/index.js";

const registry = createDefaultPromptSectionRegistry();
const section = registry.resolve("novel.identity", "1.0.0");
assert.equal(section.label, "Novel Identity");

const content = section.render();
assert.ok(content.startsWith("# 身份与创作定位"));
assert.ok(content.includes("中文网络小说创作协作者"));
assert.ok(content.includes("不抄袭"));
assert.ok(content.includes("不臆造设定"));
assert.ok(content.includes("作者是最终决策者"));

// 恒定输出：同段重复渲染逐字一致。
assert.equal(section.render(), content);

const workflow = registry.resolve("novel.workflow", "1.0.0");
const workflowContent = workflow.render();
assert.ok(workflowContent.startsWith("# 创作流程"));
assert.ok(workflowContent.includes("**大纲先行**"));
assert.ok(workflowContent.includes("**逐章推进**"));
assert.ok(workflowContent.includes("**修订闭环**"));
assert.ok(workflowContent.includes("**不一次性代写整本书**"));
assert.equal(workflow.render(), workflowContent);

const system = registry.resolve("novel.system", "1.0.0");
const systemContent = system.render();
assert.ok(systemContent.startsWith("# 系统与运行规则"));
assert.ok(systemContent.includes("**当前会话的草稿（draft）环境**"));
assert.ok(systemContent.includes("**每个会话独立**"));
assert.ok(systemContent.includes("**只有 Commit 提交、并经作者审批通过后"));
assert.ok(systemContent.includes("工具在用户选择的权限模式下执行"));
assert.ok(systemContent.includes("**提示注入**"));
assert.equal(system.render(), systemContent);

console.log("prompt-novel-sections: ok (identity + system + workflow registered and stable)");
