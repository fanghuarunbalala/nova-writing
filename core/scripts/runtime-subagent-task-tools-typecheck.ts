/** Compile-time examples for the dynamic PascalCase Subagent Tool Registry. */
import {
  SubagentDefinitionCatalog,
  SubagentTaskQueryService,
  createAgentExecutionToolRegistry,
  type SubagentBinding,
  type SubagentTaskLimits,
} from "../src/index.js";

declare const binding: SubagentBinding;
declare const limits: SubagentTaskLimits;

const definitions = new SubagentDefinitionCatalog([{
  agentType: "explore",
  definitionVersion: "1.0.0",
  label: "Explore",
  description: "Explore bounded evidence.",
  toolPolicyId: "policy-explore",
}]);
const query = new SubagentTaskQueryService({
  bindings: {
    async get() { return binding; },
    async list() { return [binding]; },
    async put() {},
    subscribe() { throw new Error("not implemented"); },
  },
  runtimePresence: {
    async getRuntimePresence() {
      return { state: "offline" as const, observedAt: "2026-08-03T00:00:00.000Z" };
    },
  },
  finalAssistantMessages: {
    async readFinalAssistantMessage() { return undefined; },
  },
  limits,
});

const registry = createAgentExecutionToolRegistry({
  definitions,
  policy: {
    allowedAgentTypes: ["explore"],
    limits,
  },
  manager: {
    async spawn() { return binding; },
    async recordTerminalStatus() { return binding; },
    getBinding() { return binding; },
    listBindings() { return [binding]; },
    getCapacity() { return { activeGlobal: 0, activeForParentRun: 0 }; },
  },
  bindings: {
    async get() { return binding; },
    async list() { return [binding]; },
    async put() {},
    subscribe() { throw new Error("not implemented"); },
  },
  query,
  cancellation: {
    async requestCancellation() { return "cancellation_requested"; },
  },
});

void registry.require("Agent").descriptor.parameters;
void registry.require("TaskOutput").handler;
void registry.require("TaskStop").handler;
