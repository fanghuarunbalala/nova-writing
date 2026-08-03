/** Compile-time examples for policy-bound Agent Runtime adapter assembly. */
import {
  AgentRuntimePolicyServices,
  InMemoryAgentRuntimePolicyServicesResolver,
  PolicyBoundAgentRuntimeAdapterFactory,
  RuntimePolicyEngine,
} from "../src/index.js";

const services = new AgentRuntimePolicyServices({
  runtimePolicyEngine: new RuntimePolicyEngine(),
});
const resolver = new InMemoryAgentRuntimePolicyServicesResolver([{
  runtimePolicyId: "default",
  contextPolicyId: "default",
  nudgePolicyId: "default",
  services,
}]);
const factory = new PolicyBoundAgentRuntimeAdapterFactory({
  services: resolver,
  delegate: undefined as never,
});

void factory;
