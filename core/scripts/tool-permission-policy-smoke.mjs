import assert from "node:assert/strict";
import {
  INITIAL_TOOL_PERMISSION_RULES,
  LayeredToolPermissionPolicy,
  TOOL_PERMISSION_POLICY_FAILURE,
  ToolPermissionPolicyError,
} from "../dist/index.js";

const invocation = Object.freeze({
  conversationId: "conversation-1",
  runId: "run-1",
  toolCallId: "tool-call-1",
  turnId: "turn-1",
  toolName: "write_file",
  arguments: Object.freeze({ path: "private-path" }),
  argumentDigest: `sha256:${"a".repeat(64)}`,
});
const trustedPolicy = Object.freeze({
  timeoutMs: 30_000,
  isolation: "trusted_process",
  cancellable: true,
  idempotent: false,
  restartable: false,
  checkpointable: false,
  retry: Object.freeze({ maximumAttempts: 1 }),
});
const rules = [
  ...INITIAL_TOOL_PERMISSION_RULES,
  {
    ruleId: "workspace.ask_write",
    source: "workspace",
    effect: "ask",
    match: { toolNames: ["write_file"] },
  },
  {
    ruleId: "agent.allow_write",
    source: "agent_definition",
    effect: "allow",
    match: { toolNames: ["write_file"] },
  },
];
const policy = new LayeredToolPermissionPolicy(rules);
assert.deepEqual(policy.listRules().map((rule) => rule.ruleId), [
  "builtin.os_isolation_unavailable",
  "workspace.ask_write",
  "agent.allow_write",
]);

const ask = policy.evaluate({
  invocation,
  toolVersion: "1.0.0",
  executionPolicy: trustedPolicy,
});
assert.deepEqual(ask, {
  effect: "ask",
  ruleIds: ["workspace.ask_write", "agent.allow_write"],
  hardRestriction: false,
});
assert.equal(Object.isFrozen(ask.ruleIds), true);

const approvalGrant = {
  grantId: "approval-request-1",
  identity: {
    conversationId: invocation.conversationId,
    runId: invocation.runId,
    toolCallId: invocation.toolCallId,
    toolName: invocation.toolName,
    toolVersion: "1.0.0",
    argumentDigest: invocation.argumentDigest,
  },
};
const approved = policy.evaluate({
  invocation,
  toolVersion: "1.0.0",
  executionPolicy: trustedPolicy,
  approvalGrant,
});
assert.deepEqual(approved, {
  effect: "allow",
  ruleIds: [
    "workspace.ask_write",
    "agent.allow_write",
    "approval-request-1",
  ],
  hardRestriction: false,
});

const changedArguments = Object.freeze({
  ...invocation,
  argumentDigest: `sha256:${"b".repeat(64)}`,
});
assert.equal(policy.evaluate({
  invocation: changedArguments,
  toolVersion: "1.0.0",
  executionPolicy: trustedPolicy,
  approvalGrant,
}).effect, "ask");

const isolated = policy.evaluate({
  invocation,
  toolVersion: "1.0.0",
  executionPolicy: Object.freeze({ ...trustedPolicy, isolation: "os_process" }),
  approvalGrant,
});
assert.deepEqual(isolated, {
  effect: "deny",
  ruleIds: [
    "builtin.os_isolation_unavailable",
    "workspace.ask_write",
    "agent.allow_write",
  ],
  hardRestriction: true,
});

const defaultDeny = new LayeredToolPermissionPolicy([]).evaluate({
  invocation,
  toolVersion: "1.0.0",
  executionPolicy: trustedPolicy,
});
assert.deepEqual(defaultDeny, {
  effect: "deny",
  ruleIds: ["builtin.default_deny"],
  hardRestriction: false,
});

assertPolicyFailure(
  () => new LayeredToolPermissionPolicy([
    { ruleId: "workspace.duplicate", source: "workspace", effect: "allow" },
    { ruleId: "workspace.duplicate", source: "workspace", effect: "deny" },
  ]),
  TOOL_PERMISSION_POLICY_FAILURE.duplicateRule,
);
assertPolicyFailure(
  () => new LayeredToolPermissionPolicy([
    {
      ruleId: "workspace.invalid_hard",
      source: "workspace",
      effect: "deny",
      hardRestriction: true,
    },
  ]),
  TOOL_PERMISSION_POLICY_FAILURE.invalidRule,
);

const serialized = JSON.stringify({ ask, approved, isolated, defaultDeny });
assert.equal(serialized.includes("private-path"), false);
console.log("tool permission policy smoke passed");

function assertPolicyFailure(invoke, expectedFailure) {
  assert.throws(invoke, (error) => {
    assert.equal(error instanceof ToolPermissionPolicyError, true);
    assert.equal(error.failure, expectedFailure);
    return true;
  });
}
