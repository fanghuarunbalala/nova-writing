import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Type } from "typebox";
import {
  AgentManifestResolver,
  PromptCapabilitySnapshot,
  SystemPromptBuilder,
  ToolGroupCatalog,
  ToolPromptDetails,
  ToolRegistry,
  ToolRegistryView,
  createDefaultPromptSectionRegistry,
  defineTool,
  loadToolGroupManifest,
  novelAgentDefinition,
} from "../dist/index.js";

class Sha256Digester {
  algorithm = "sha256";

  async digest(content) {
    return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
  }
}

const digester = new Sha256Digester();
const todoDetails = new ToolPromptDetails({
  usage: "Track non-trivial execution work.",
  parameterGuidance: "Keep IDs stable and update only the intended item.",
  safetyGuidance: "Never use it as a substitute for persisted novel content.",
});
assert.equal(Object.isFrozen(todoDetails), true);
assert.deepEqual(todoDetails.toSnapshot(), {
  usage: "Track non-trivial execution work.",
  parameterGuidance: "Keep IDs stable and update only the intended item.",
  safetyGuidance: "Never use it as a substitute for persisted novel content.",
});
assert.throws(() => new ToolPromptDetails({}), /must contain guidance/);
assert.throws(
  () => new ToolPromptDetails({ usage: "ok", unsupported: "no" }),
  /unknown fields/,
);

const todoTool = defineTool({
  descriptor: {
    name: "TodoWrite",
    version: "1.0.0",
    label: "Todo Write",
    description: "Maintains the current execution plan.",
    parameters: Type.Object({}),
    promptDetails: todoDetails,
  },
  handler: { async execute() { return { content: [] }; } },
});
const clearContextTool = defineTool({
  descriptor: {
    name: "ClearContext",
    version: "1.0.0",
    label: "Clear Context",
    description: "Clears a Runtime context projection.",
    parameters: Type.Object({}),
  },
  handler: { async execute() { return { content: [] }; } },
});
const registry = new ToolRegistry([clearContextTool, todoTool]);
const groups = new ToolGroupCatalog([
  loadToolGroupManifest(`
schemaVersion: 1
id: runtime.todo
version: 1.0.0
label: Runtime todo tools
tools: [TodoWrite, ClearContext]
`),
]);

const allowedView = new ToolRegistryView({
  registry,
  groups,
  policy: { groupIds: ["runtime.todo"] },
});
assert.deepEqual(
  allowedView.listAllowed().map((tool) => tool.descriptor.name),
  ["TodoWrite", "ClearContext"],
);
assert.equal(allowedView.require("ClearContext").descriptor.promptDetails, undefined);
assert.deepEqual(
  allowedView.require("TodoWrite").descriptor.promptDetails?.toSnapshot(),
  todoDetails.toSnapshot(),
);

const deniedView = new ToolRegistryView({
  registry,
  groups,
  policy: { groupIds: ["runtime.todo"], deny: ["ClearContext"] },
});
assert.deepEqual(
  deniedView.listAllowed().map((tool) => tool.descriptor.name),
  ["TodoWrite"],
);

const promptBuilder = new SystemPromptBuilder({
  sections: createDefaultPromptSectionRegistry(),
  digester,
});
const capabilityOptions = (view) => view.listAllowed().map((tool) => ({
  name: tool.descriptor.name,
  version: tool.descriptor.version,
  label: tool.descriptor.label,
  description: tool.descriptor.description,
  ...(tool.descriptor.promptDetails === undefined
    ? {}
    : { promptDetails: tool.descriptor.promptDetails.toSnapshot() }),
}));
const allCapabilities = new PromptCapabilitySnapshot(capabilityOptions(allowedView));
const deniedCapabilities = new PromptCapabilitySnapshot(capabilityOptions(deniedView));
const allPrompt = await promptBuilder.build({
  definition: novelAgentDefinition,
  capabilities: allCapabilities,
});
const deniedPrompt = await promptBuilder.build({
  definition: novelAgentDefinition,
  capabilities: deniedCapabilities,
});
assert.match(allPrompt.content, /Usage: Track non-trivial execution work\./);
assert.match(allPrompt.content, /Parameters: Keep IDs stable/);
assert.match(allPrompt.content, /Safety: Never use it/);
assert.doesNotMatch(deniedPrompt.content, /ClearContext/);

const createManifest = (promptCapabilities) => new AgentManifestResolver({
  promptBuilder,
  promptCapabilities,
  manifestIdFactory: { create() { return "manifest:tool-prompt-details"; } },
  clock: { now() { return "2026-08-03T00:00:00.000Z"; } },
  digester,
}).resolve(novelAgentDefinition);
const manifestWithGuidance = await createManifest(allCapabilities);
const manifestWithoutGuidance = await createManifest(new PromptCapabilitySnapshot([{
  name: "TodoWrite",
  version: "1.0.0",
  label: "Todo Write",
  description: "Maintains the current execution plan.",
}]));
assert.notEqual(
  manifestWithGuidance.manifestDigest,
  manifestWithoutGuidance.manifestDigest,
);

console.log("tool prompt details smoke: passed");
