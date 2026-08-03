/** Compile-time examples for immutable Agent Runtime configuration values. */
import {
  AgentAssembly,
  AgentRuntimeConfiguration,
  AgentRuntimeExecutionLimits,
  AgentRuntimePolicyReferences,
} from "../src/index.js";

const policies = new AgentRuntimePolicyReferences({
  runtimePolicyId: "default",
  contextPolicyId: "default",
  nudgePolicyId: "default",
});
const limits = new AgentRuntimeExecutionLimits({
  maximumTurns: 20,
  maximumProviderCallsPerTurn: 2,
  maximumToolCallsPerTurn: 16,
  providerCallTimeoutMs: 60_000,
  toolExecutionTimeoutMs: 30_000,
});
const assembly = undefined as never as AgentAssembly;
const configuration = new AgentRuntimeConfiguration({
  conversationId: "conversation-1",
  assembly,
  policies,
  limits,
});

// @ts-expect-error Runtime configuration is immutable.
configuration.conversationId = "changed";
// @ts-expect-error Runtime limits are immutable.
limits.maximumTurns = 1;

void configuration;
