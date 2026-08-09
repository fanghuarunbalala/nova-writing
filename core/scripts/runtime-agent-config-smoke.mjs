import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  AgentAssembler,
  AgentManifestResolver,
  AgentRuntimeConfiguration,
  AgentRuntimeExecutionLimits,
  AgentRuntimePolicyReferences,
  AgentToolPolicy,
  InMemoryAgentManifestStore,
  PromptCapabilitySnapshot,
  ManifestSystemPromptCompiler,
  createDefaultPromptSectionRegistry,
  novelAgentDefinition,
} from "../dist/index.js";
import {
  createNovelConversationManifestComposition,
} from "../dist/node/index.js";

class Sha256Digester {
  algorithm = "sha256";

  async digest(content) {
    return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
  }
}

const capabilities = new PromptCapabilitySnapshot([{
  name: "TodoWrite",
  version: "1.0.0",
  label: "Todo Write",
  description: "Maintains the current execution plan.",
}]);
const builder = new ManifestSystemPromptCompiler({
  sections: createDefaultPromptSectionRegistry(),
  digester: new Sha256Digester(),
});
const resolver = new AgentManifestResolver({
  promptBuilder: builder,
  promptCapabilities: capabilities,
  manifestIdFactory: { create() { return "manifest:runtime-config"; } },
  clock: { now() { return "2026-08-03T00:00:00.000Z"; } },
  digester: new Sha256Digester(),
});
const composition = createNovelConversationManifestComposition();
const assembly = await new AgentAssembler({
  registry: composition.registry,
  groups: composition.groups,
  manifestResolver: resolver,
  manifestStore: new InMemoryAgentManifestStore(),
}).assemble(novelAgentDefinition);

const configuration = new AgentRuntimeConfiguration({
  conversationId: "conversation:runtime-config",
  assembly,
  policies: new AgentRuntimePolicyReferences({
    runtimePolicyId: "default",
    contextPolicyId: "default",
    nudgePolicyId: "default",
  }),
  limits: new AgentRuntimeExecutionLimits({
    maximumTurns: 20,
    maximumProviderCallsPerTurn: 2,
    maximumToolCallsPerTurn: 16,
    providerCallTimeoutMs: 60_000,
    toolExecutionTimeoutMs: 30_000,
  }),
});

assert.equal(configuration.conversationId, "conversation:runtime-config");
assert.equal(configuration.assembly, assembly);
assert.equal(configuration.assembly.manifest.runtimePolicyId, "default");
assert.equal(configuration.limits.maximumProviderCallsPerTurn, 2);
assert.equal(Object.isFrozen(configuration), true);
assert.equal(Object.isFrozen(configuration.policies), true);
assert.equal(Object.isFrozen(configuration.limits), true);
assert.equal(Object.isFrozen(configuration.toSnapshot()), true);
assert.throws(() => { configuration.conversationId = "changed"; }, TypeError);

assert.throws(
  () => new AgentRuntimeConfiguration({
    conversationId: "conversation:runtime-config",
    assembly,
    policies: new AgentRuntimePolicyReferences({
      runtimePolicyId: "other",
      contextPolicyId: "default",
      nudgePolicyId: "default",
    }),
    limits: configuration.limits,
  }),
  /Runtime policy does not match Agent Manifest/,
);

console.log("Agent Runtime configuration smoke passed");
