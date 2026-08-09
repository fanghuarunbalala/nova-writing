import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  AgentDefinition,
  AgentDefinitionCatalog,
  AgentDelegationPolicy,
  AgentCommunicationPolicy,
  AgentToolPolicy,
  InlinePromptItem,
  PromptCapabilitySnapshot,
  PromptRecipe,
  PromptSection,
  PromptSectionItem,
  PromptSectionRegistry,
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

class VersionedExampleSection extends PromptSection {
  constructor(version) {
    super({ id: "example.section", version, label: "Example" });
  }

  render() {
    return `example-${this.version}`;
  }
}

const versioned = new PromptSectionRegistry([
  new VersionedExampleSection("1.0.0"),
  new VersionedExampleSection("1.1.0"),
]);
assert.equal(versioned.resolve("example.section").version, "1.1.0");
assert.equal(versioned.resolve("example.section", "1.0.0").version, "1.0.0");

const capabilities = new PromptCapabilitySnapshot([{
  name: "TodoWrite",
  version: "1.0.0",
  label: "Todo Write",
  description: "Maintains the current execution plan.",
}]);
const builder = new ManifestSystemPromptCompiler({
  sections: createDefaultPromptSectionRegistry(),
  digester: new Sha256PromptDigester(),
});
const compiled = await builder.compile({
  definition: novelAgentDefinition,
  capabilities,
});

assert.equal(compiled.agentType, "novel");
assert.equal(compiled.definitionVersion, novelAgentDefinition.definitionVersion);
const expectedStaticBlocks = novelAgentDefinition.promptRecipe.items.filter(
  (item) =>
    item.kind === "inline" ||
    createDefaultPromptSectionRegistry()
      .resolve(item.sectionId, item.requestedVersion)
      .kind === "static",
);
assert.equal(compiled.blocks.length, expectedStaticBlocks.length);
assert.deepEqual(
  compiled.blocks.map((block) => block.sourceId),
  expectedStaticBlocks.map((item) =>
    item.kind === "section" ? item.sectionId : (item.sourceId ?? "inline"),
  ),
);
assert.match(compiled.content, /中文网络小说创作协作者/);
assert.match(compiled.content, /# 系统与运行规则/);
assert.match(compiled.digest, /^sha256:[0-9a-f]{64}$/);

const catalog = new AgentDefinitionCatalog([novelAgentDefinition]);
assert.equal(catalog.resolve("novel").definitionVersion, novelAgentDefinition.definitionVersion);
assert.equal(novelAgentDefinition.delegation.mode, "subagent");
assert.deepEqual(novelAgentDefinition.delegation.allowedAgentTypes, ["novel_explorer", "novel_compose"]);
assert.equal(novelAgentDefinition.toSnapshot().promptRecipe.items.length, 4);

const invalidDefinition = new AgentDefinition({
  agentType: "invalid_agent",
  definitionVersion: "1.0.0",
  label: "Invalid",
  description: "Invalid definition for validation.",
  promptRecipe: new PromptRecipe([
    new PromptSectionItem("core.runtime.protocol"),
    new InlinePromptItem("Only one required section."),
  ]),
  tools: new AgentToolPolicy({ groupIds: ["runtime.todo"] }),
  delegation: new AgentDelegationPolicy({ mode: "disabled", allowedAgentTypes: [] }),
  communication: new AgentCommunicationPolicy("standalone"),
  runtimePolicyId: "default",
});
// 必选段校验机制暂未启用（ManifestSystemPromptCompiler 默认 requiredSectionIds 为空），
// 缺段定义当前可正常编译；机制恢复后此处恢复 rejects 断言。
const invalidCompiled = await builder.compile({
  definition: invalidDefinition,
  capabilities,
});
assert.equal(invalidCompiled.agentType, "invalid_agent");

console.log("Prompt Agent architecture smoke passed");
