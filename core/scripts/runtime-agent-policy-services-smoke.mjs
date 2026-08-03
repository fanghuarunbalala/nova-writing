import assert from "node:assert/strict";
import {
  AGENT_RUNTIME_POLICY_SERVICES_FAILURE,
  AgentRuntimeConfiguration,
  AgentRuntimeExecutionLimits,
  AgentRuntimePolicyReferences,
  AgentRuntimePolicyServices,
  AgentRuntimePolicyServicesError,
  InMemoryAgentRuntimePolicyServicesResolver,
  NUDGE_SELECTION_LIMIT,
  PolicyBoundAgentRuntimeAdapterFactory,
  RuntimePolicyEngine,
} from "../dist/index.js";

const assembly = Object.freeze({
  agentType: "novel_agent",
  definitionVersion: "1.0.0",
  manifest: Object.freeze({ runtimePolicyId: "default" }),
  systemPrompt: Object.freeze({ content: "PRIVATE_PROMPT", digest: `sha256:${"a".repeat(64)}` }),
  toolView: Object.freeze({ listAllowed() { return []; } }),
  toSnapshot() {
    return Object.freeze({
      manifestId: "manifest:policy",
      manifestDigest: `sha256:${"b".repeat(64)}`,
      agentType: "novel_agent",
      definitionVersion: "1.0.0",
      promptDigest: `sha256:${"a".repeat(64)}`,
      tools: Object.freeze([]),
    });
  },
});
const configuration = new AgentRuntimeConfiguration({
  conversationId: "conversation:policy",
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
const policyServices = new AgentRuntimePolicyServices({
  runtimePolicyEngine: new RuntimePolicyEngine(),
  contextProjectionProviderCalls: { kind: "context" },
  checkpointApplications: { kind: "checkpoint" },
  nudgeProviderCalls: { kind: "nudge" },
});
const resolver = new InMemoryAgentRuntimePolicyServicesResolver([{
  runtimePolicyId: "default",
  contextPolicyId: "default",
  nudgePolicyId: "default",
  services: policyServices,
}]);
const created = [];
const adapter = { async stream() {}, async cancel() {} };
const factory = new PolicyBoundAgentRuntimeAdapterFactory({
  services: resolver,
  delegate: {
    async create(receivedConfiguration, receivedServices) {
      created.push({ receivedConfiguration, receivedServices });
      return adapter;
    },
  },
});

assert.equal(await factory.create(configuration), adapter);
assert.equal(created[0].receivedConfiguration, configuration);
assert.equal(created[0].receivedServices, policyServices);
assert.equal(NUDGE_SELECTION_LIMIT.maximum, 2);
assert.equal(Object.isFrozen(policyServices), true);

const missingConfiguration = new AgentRuntimeConfiguration({
  conversationId: "conversation:policy-missing",
  assembly,
  policies: new AgentRuntimePolicyReferences({
    runtimePolicyId: "default",
    contextPolicyId: "other",
    nudgePolicyId: "default",
  }),
  limits: configuration.limits,
});
await assert.rejects(
  resolver.resolve(missingConfiguration),
  (error) =>
    error instanceof AgentRuntimePolicyServicesError &&
    error.failure === AGENT_RUNTIME_POLICY_SERVICES_FAILURE.profileMissing,
);

console.log("Agent Runtime policy services smoke passed");
