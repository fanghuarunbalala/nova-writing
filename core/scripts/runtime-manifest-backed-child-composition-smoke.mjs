import assert from "node:assert/strict";
import {
  AgentRuntimeConfigurationFactory,
  AgentRuntimeExecutionAssembler,
  AgentRuntimeExecutionLimits,
  AgentRuntimePolicyReferences,
} from "../dist/index.js";
import { ManifestBackedRuntimeChildCompositionFactory } from "../dist/node/index.js";

const manifest = Object.freeze({
  manifestId: "manifest:runtime-child",
  manifestDigest: `sha256:${"a".repeat(64)}`,
  agentType: "novel_agent",
  definitionVersion: "1.0.0",
  runtimePolicyId: "default",
});
const assembly = Object.freeze({
  manifest,
  toolView: Object.freeze({ listAllowed() { return []; } }),
  agentType: manifest.agentType,
  definitionVersion: manifest.definitionVersion,
  toSnapshot() {
    return Object.freeze({
      manifestId: manifest.manifestId,
      manifestDigest: manifest.manifestDigest,
      agentType: manifest.agentType,
      definitionVersion: manifest.definitionVersion,
      promptDigest: `sha256:${"b".repeat(64)}`,
      tools: Object.freeze([]),
    });
  },
});
const bootstrap = Object.freeze({
  schemaVersion: 1,
  runtimeInstanceId: "runtime-child",
  activatedAt: "2026-08-03T04:00:00.000Z",
  conversation: Object.freeze({
    metadata: Object.freeze({ id: "conversation-child" }),
    activeAgentBinding: Object.freeze({
      agentType: manifest.agentType,
      definitionVersion: manifest.definitionVersion,
      manifestId: manifest.manifestId,
      manifestDigest: manifest.manifestDigest,
    }),
  }),
  workspace: Object.freeze({ workspaceId: "workspace-child", workdir: "/private/workdir" }),
  activation: Object.freeze({ reason: "explicit_restore" }),
  journal: Object.freeze({ highWatermark: 0 }),
});
const calls = [];
const configurationFactory = new AgentRuntimeConfigurationFactory({
  manifestStore: { async get(manifestId) { assert.equal(manifestId, manifest.manifestId); return manifest; } },
  assemblyRestorer: { restore(restoredManifest) { assert.equal(restoredManifest, manifest); return assembly; } },
  profileResolver: {
    async resolve(runtimePolicyId) {
      assert.equal(runtimePolicyId, "default");
      return {
        policies: new AgentRuntimePolicyReferences({
          runtimePolicyId: "default",
          contextPolicyId: "default",
          nudgePolicyId: "default",
        }),
        limits: new AgentRuntimeExecutionLimits({
          maximumTurns: 4,
          maximumProviderCallsPerTurn: 2,
          maximumToolCallsPerTurn: 4,
          providerCallTimeoutMs: 1_000,
          toolExecutionTimeoutMs: 1_000,
        }),
      };
    },
  },
});
const executionAssembler = new AgentRuntimeExecutionAssembler({
  contextCompilerFactory: {
    async create(configuration) {
      calls.push(["context", configuration.conversationId]);
      return Object.freeze({ compile: async (request) => request });
    },
  },
  adapterFactory: {
    async create(configuration) {
      calls.push(["adapter", configuration.conversationId]);
      return Object.freeze({
        stream: async () => ({ conversationId: configuration.conversationId, runId: "run", outcome: "completed" }),
        cancel: async () => {},
      });
    },
  },
});
const delegate = {
  async create(receivedBootstrap, context) {
    assert.equal(receivedBootstrap, bootstrap);
    assert.equal(context.persistence.journal, "journal-port");
    assert.equal(context.executionAssembly.configuration.conversationId, "conversation-child");
    return Object.freeze({
      conversationId: "conversation-child",
      runtimeInstanceId: "runtime-child",
      start: async () => ({ conversationId: "conversation-child", runtimeInstanceId: "runtime-child", activationReason: "explicit_restore", throughSequence: 0, scannedEventCount: 0, processedInputCount: 0, outcomeRepairCount: 0, routedInputCount: 0 }),
      dispatchInput: async () => {},
      shutdown: async () => {},
      waitForExit: async () => ({ kind: "stopped", exitedAt: "2026-08-03T04:00:01.000Z", reason: "explicit_shutdown" }),
    });
  },
};
const factory = new ManifestBackedRuntimeChildCompositionFactory({
  configurationFactory,
  executionAssembler,
  delegate,
});
const runtime = await factory.create(bootstrap, {
  persistence: Object.freeze({ journal: "journal-port", runtimeState: "runtime-state-port" }),
});

assert.equal(runtime.conversationId, "conversation-child");
assert.deepEqual(calls, [
  ["context", "conversation-child"],
  ["adapter", "conversation-child"],
]);

console.log("Manifest-backed child composition smoke passed");
