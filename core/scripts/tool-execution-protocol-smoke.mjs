import assert from "node:assert/strict";
import {
  TOOL_EXECUTION_PROTOCOL_FAILURE,
  ToolError,
  ToolExecutionProtocolError,
  canonicalToolArguments,
  captureToolApprovalIdentity,
  captureToolExecutionPolicy,
  captureToolInvocation,
  captureToolPermissionDecision,
  captureToolTraceRecord,
} from "../dist/index.js";

const privateArguments = "do-not-expose-tool-arguments";
const digester = Object.freeze({
  async digest(arguments_) {
    assert.equal(canonicalToolArguments(arguments_), `{"query":"${privateArguments}"}`);
    return `sha256:${"a".repeat(64)}`;
  },
});
const source = {
  conversationId: "conversation-1",
  runId: "run-1",
  toolCallId: "tool-call-1",
  turnId: "turn-1",
  toolName: "SearchNotes",
  arguments: { query: privateArguments },
};
const invocation = await captureToolInvocation(source, digester);
source.arguments.query = "mutated";
assert.equal(Object.isFrozen(invocation), true);
assert.equal(invocation.arguments.query, privateArguments);
assert.equal(invocation.argumentDigest, `sha256:${"a".repeat(64)}`);

const policy = captureToolExecutionPolicy({
  timeoutMs: 30_000,
  isolation: "trusted_process",
  cancellable: true,
  idempotent: true,
  restartable: false,
  checkpointable: false,
  retry: { maximumAttempts: 2 },
});
assert.equal(Object.isFrozen(policy.retry), true);
assertProtocolFailure(
  () => captureToolExecutionPolicy({ ...policy, cancellable: false }),
  TOOL_EXECUTION_PROTOCOL_FAILURE.invalidExecutionPolicy,
);

const decision = captureToolPermissionDecision({
  effect: "deny",
  ruleIds: ["builtin.real_isolation_required"],
  hardRestriction: true,
});
assert.equal(Object.isFrozen(decision.ruleIds), true);

const approvalIdentity = captureToolApprovalIdentity({
  ...invocation,
  toolVersion: "1.0.0",
});
assert.equal(approvalIdentity.argumentDigest, invocation.argumentDigest);

const trace = captureToolTraceRecord({
  traceId: "trace-1",
  ...approvalIdentity,
  turnId: "turn-1",
  stage: "permission_evaluated",
  timestamp: "2026-08-02T00:00:00.000Z",
  attempt: 1,
  ruleIds: ["workspace.default"],
  permissionEffect: "ask",
  inputBytes: 40,
});
assert.equal(Object.isFrozen(trace), true);
assert.equal("arguments" in trace, false);
assert.equal(JSON.stringify(trace).includes(privateArguments), false);

const toolError = new ToolError({
  code: "TOOL_HANDLER_FAILED",
  category: "execution",
  retryable: true,
  sideEffectStatus: "none",
  conversationId: "conversation-1",
  toolCallId: "tool-call-1",
});
assert.equal(toolError.retryable, true);
assert.equal(toolError.sideEffectStatus, "none");
assert.equal(JSON.stringify(toolError).includes(privateArguments), false);

assertProtocolFailure(
  () => captureToolTraceRecord({ ...trace, errorCode: privateArguments }),
  TOOL_EXECUTION_PROTOCOL_FAILURE.invalidTraceRecord,
);

console.log("tool execution protocol smoke passed");

function assertProtocolFailure(invoke, expectedFailure) {
  assert.throws(invoke, (error) => {
    assert.equal(error instanceof ToolExecutionProtocolError, true);
    assert.equal(error.failure, expectedFailure);
    assert.equal(JSON.stringify(error).includes(privateArguments), false);
    assert.equal(String(error).includes(privateArguments), false);
    return true;
  });
}
