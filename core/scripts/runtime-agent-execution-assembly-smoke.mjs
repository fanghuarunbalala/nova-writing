import assert from "node:assert/strict";
import {
  AgentRuntimeConfiguration,
  AgentRuntimeExecutionAssembler,
  AgentRuntimeExecutionLimits,
  AgentRuntimePolicyReferences,
} from "../dist/index.js";

const privatePrompt = "PRIVATE_BASE_SYSTEM_PROMPT";
const assemblySnapshot = Object.freeze({
  manifestId: "manifest:execution",
  manifestDigest: `sha256:${"a".repeat(64)}`,
  agentType: "novel_agent",
  definitionVersion: "1.0.0",
  promptDigest: `sha256:${"b".repeat(64)}`,
  tools: Object.freeze([]),
});
const agentAssembly = Object.freeze({
  agentType: "novel_agent",
  definitionVersion: "1.0.0",
  manifest: Object.freeze({
    runtimePolicyId: "default",
    manifestId: assemblySnapshot.manifestId,
    manifestDigest: assemblySnapshot.manifestDigest,
  }),
  systemPrompt: Object.freeze({
    content: privatePrompt,
    digest: assemblySnapshot.promptDigest,
  }),
  toolView: Object.freeze({ listAllowed() { return []; } }),
  toSnapshot() { return assemblySnapshot; },
});
const configuration = new AgentRuntimeConfiguration({
  conversationId: "conversation:execution",
  assembly: agentAssembly,
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
const calls = [];
const contextCompiler = {
  async compile(request) {
    calls.push({ kind: "context", conversationId: request.conversationId });
    return Object.freeze({ ...request, messages: Object.freeze([...request.messages]) });
  },
};
const agentAdapter = {
  async stream(request) {
    calls.push({ kind: "stream", conversationId: request.conversationId });
    return { conversationId: request.conversationId, runId: request.runId, outcome: "completed" };
  },
  async cancel() {},
};
const logs = [];
const logger = {
  debug(event, fields) { logs.push({ event, fields }); },
  info(event, fields) { logs.push({ event, fields }); },
  warn() {},
  error() {},
  child() { return this; },
};
const execution = await new AgentRuntimeExecutionAssembler({
  contextCompilerFactory: {
    async create(received) {
      assert.equal(received, configuration);
      return contextCompiler;
    },
  },
  adapterFactory: {
    async create(received) {
      assert.equal(received, configuration);
      return agentAdapter;
    },
  },
  logger,
}).assemble(configuration);

assert.equal(execution.configuration, configuration);
assert.equal(execution.contextCompiler, contextCompiler);
assert.equal(execution.agentAdapter, agentAdapter);
assert.equal(
  await execution.systemPromptSource.resolve({
    conversationId: "conversation:execution",
    runId: "run:execution",
    input: { id: "input:execution" },
  }),
  privatePrompt,
);
await assert.rejects(
  execution.systemPromptSource.resolve({
    conversationId: "conversation:other",
    runId: "run:execution",
    input: { id: "input:execution" },
  }),
  /another Conversation/,
);
assert.equal(JSON.stringify(logs).includes(privatePrompt), false);
assert.equal(Object.isFrozen(execution), true);

console.log("Agent Runtime execution assembly smoke passed");
