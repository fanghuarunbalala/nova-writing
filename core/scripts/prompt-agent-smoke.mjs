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
  SystemPromptBuilder,
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
const builder = new SystemPromptBuilder({
  sections: createDefaultPromptSectionRegistry(),
  digester: new Sha256PromptDigester(),
});
const compiled = await builder.build({
  definition: novelAgentDefinition,
  capabilities,
});

assert.equal(compiled.agentType, "novel");
assert.equal(compiled.definitionVersion, "1.0.0");
assert.equal(compiled.blocks.length, 8);
assert.deepEqual(
  compiled.blocks.map((block) => block.sourceId),
  [
    "core.runtime.protocol",
    "agent.identity",
    "conversation.behavior",
    "inline:4",
    "tool.guidance",
    "todo.guidance",
    "context.reliability",
    "completion.contract",
  ],
);
assert.match(compiled.content, /Agent type: novel/);
assert.match(compiled.content, /TodoWrite@1.0.0/);
assert.match(compiled.content, /Respond in the language/);
assert.match(compiled.digest, /^sha256:[0-9a-f]{64}$/);

const catalog = new AgentDefinitionCatalog([novelAgentDefinition]);
assert.equal(catalog.resolve("novel").definitionVersion, "1.0.0");
assert.equal(novelAgentDefinition.delegation.mode, "disabled");
assert.deepEqual(novelAgentDefinition.delegation.allowedAgentTypes, []);
assert.deepEqual(novelAgentDefinition.toSnapshot().promptRecipe.items[3], {
  kind: "inline",
  content: "Respond in the language currently used by the user.",
});

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
await assert.rejects(
  builder.build({ definition: invalidDefinition, capabilities }),
  /Required Prompt Section is missing/,
);

console.log("Prompt Agent architecture smoke passed");
