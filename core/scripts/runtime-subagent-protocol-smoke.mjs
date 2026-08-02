import assert from "node:assert/strict";
import {
  SUBAGENT_LIMITS,
  SubagentProtocolError,
  captureSubagentBinding,
  captureSubagentRequest,
  captureSubagentResult,
} from "../dist/index.js";

const request = captureSubagentRequest({
  schemaVersion: 1,
  subagentId: "subagent-1",
  parentConversationId: "conversation-parent",
  parentRunId: "run-parent",
  parentTurnId: "turn-parent",
  agentType: "novel.explore",
  definitionVersion: "1.0.0",
  objective: "Inspect the accepted story constraints.",
  toolPolicyId: "policy-child-reduced",
  requestedAt: "2026-08-02T00:00:00.000Z",
});
assert.equal(Object.isFrozen(request), true);
assert.deepEqual(SUBAGENT_LIMITS, {
  maximumDepth: 1,
  maximumActivePerParentRun: 4,
  maximumActiveGlobal: 16,
});

const binding = captureSubagentBinding({
  schemaVersion: 1,
  subagentId: request.subagentId,
  parentConversationId: request.parentConversationId,
  parentRunId: request.parentRunId,
  parentTurnId: request.parentTurnId,
  childConversationId: "conversation-child",
  depth: 1,
  agentType: request.agentType,
  definitionVersion: request.definitionVersion,
  toolPolicyId: request.toolPolicyId,
  status: "running",
  createdAt: "2026-08-02T00:00:01.000Z",
  updatedAt: "2026-08-02T00:00:02.000Z",
});
assert.equal(Object.isFrozen(binding), true);

const result = captureSubagentResult({
  schemaVersion: 1,
  subagentId: binding.subagentId,
  parentConversationId: binding.parentConversationId,
  parentRunId: binding.parentRunId,
  childConversationId: binding.childConversationId,
  status: "completed",
  summary: "The constraints are internally consistent.",
  artifactReferences: [{
    schemaVersion: 1,
    artifactId: "artifact-subagent-1",
    conversationId: binding.childConversationId,
    contentType: "application/json",
    byteLength: 128,
    tokenEstimate: 32,
    digest: `sha256:${"a".repeat(64)}`,
    filename: "result.json",
  }],
  completedAt: "2026-08-02T00:00:03.000Z",
}, binding);
assert.equal(result.status, "completed");
assert.equal(Object.isFrozen(result.artifactReferences), true);
assert.equal(Object.isFrozen(result.artifactReferences[0]), true);

const failed = captureSubagentResult({
  schemaVersion: 1,
  subagentId: binding.subagentId,
  parentConversationId: binding.parentConversationId,
  parentRunId: binding.parentRunId,
  childConversationId: binding.childConversationId,
  status: "failed",
  artifactReferences: [],
  errorCode: "SUBAGENT_EXECUTION_FAILED",
  completedAt: "2026-08-02T00:00:04.000Z",
});
assert.equal(failed.errorCode, "SUBAGENT_EXECUTION_FAILED");

const cancelled = captureSubagentResult({
  schemaVersion: 1,
  subagentId: binding.subagentId,
  parentConversationId: binding.parentConversationId,
  parentRunId: binding.parentRunId,
  childConversationId: binding.childConversationId,
  status: "cancelled",
  artifactReferences: [],
  cancellationReason: "parent_stopped",
  completedAt: "2026-08-02T00:00:05.000Z",
});
assert.equal(cancelled.cancellationReason, "parent_stopped");

for (const invalid of [
  { ...request, unknown: true },
  { ...request, objective: "x".repeat(16 * 1024 + 1) },
  { ...binding, depth: 2 },
  { ...binding, updatedAt: "2026-08-01T23:59:59.000Z" },
]) {
  assert.throws(
    () => invalid.depth === undefined
      ? captureSubagentRequest(invalid)
      : captureSubagentBinding(invalid),
    SubagentProtocolError,
  );
}

assert.throws(() => captureSubagentResult({
  ...result,
  childConversationId: "conversation-other",
  artifactReferences: [],
}, binding), (error) => error instanceof SubagentProtocolError && error.failure === "identity_mismatch");
assert.throws(() => captureSubagentResult({
  ...result,
  status: "failed",
  errorCode: undefined,
}), SubagentProtocolError);
assert.throws(() => captureSubagentResult({
  ...result,
  artifactReferences: [{
    ...result.artifactReferences[0],
    conversationId: "conversation-other",
  }],
}), SubagentProtocolError);

const accessorArtifacts = [];
Object.defineProperty(accessorArtifacts, "0", {
  enumerable: true,
  get() { return result.artifactReferences[0]; },
});
accessorArtifacts.length = 1;
assert.throws(() => captureSubagentResult({
  ...result,
  artifactReferences: accessorArtifacts,
}), SubagentProtocolError);

console.log("Runtime Subagent protocol smoke passed");
