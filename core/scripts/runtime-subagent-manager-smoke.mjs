import assert from "node:assert/strict";
import {
  CHILD_CONVERSATION_MANAGER_FAILURE,
  ChildConversationManagerError,
  DefaultChildConversationManager,
  SUBAGENT_SCHEMA_VERSION,
  SUBAGENT_STATUS,
  SUBAGENT_TOOL_POLICY_RELATION,
} from "../dist/index.js";

const timestamp = "2026-08-02T08:00:00.000Z";

class CapturingLogger {
  records = [];
  child() { return this; }
  debug(event, fields) { this.records.push({ level: "debug", event, fields }); }
  info(event, fields) { this.records.push({ level: "info", event, fields }); }
  warn(event, fields) { this.records.push({ level: "warn", event, fields }); }
  error(event, fields) { this.records.push({ level: "error", event, fields }); }
}

function request(subagentId, options = {}) {
  return {
    schemaVersion: SUBAGENT_SCHEMA_VERSION,
    subagentId,
    parentConversationId: options.parentConversationId ?? "conversation-parent",
    parentRunId: options.parentRunId ?? "run-parent",
    parentTurnId: "turn-parent",
    agentType: "explore",
    definitionVersion: "v1",
    objective: `private objective ${subagentId}`,
    toolPolicyId: options.toolPolicyId ?? "policy-child",
    requestedAt: timestamp,
  };
}

function createHarness(options = {}) {
  const created = [];
  const activated = [];
  const rolledBack = [];
  const logger = new CapturingLogger();
  const failCreation = options.failCreation ?? new Set();
  const failActivation = options.failActivation ?? new Set();
  const failRollback = options.failRollback ?? new Set();
  const invalidCreation = options.invalidCreation ?? new Set();
  const manager = new DefaultChildConversationManager({
    parentScopeReader: {
      async readParentScope(input) {
        if (options.parentScopeError) throw new Error("private parent error");
        return {
          parentConversationId: input.parentConversationId,
          parentRunId: input.parentRunId,
          workspaceId: "workspace-main",
          depth: options.depthByParent?.get(input.parentConversationId) ?? 0,
          toolPolicyId: "policy-parent",
        };
      },
    },
    toolPolicyRelationReader: {
      async readRelation(_parentPolicyId, childPolicyId) {
        if (options.policyError) throw new Error("private policy error");
        return childPolicyId === "policy-expanded"
          ? SUBAGENT_TOOL_POLICY_RELATION.expanded
          : childPolicyId === "policy-unknown"
            ? SUBAGENT_TOOL_POLICY_RELATION.unknown
            : childPolicyId === "policy-parent"
              ? SUBAGENT_TOOL_POLICY_RELATION.same
              : SUBAGENT_TOOL_POLICY_RELATION.reduced;
      },
    },
    creationPort: {
      async createChild(input) {
        created.push(input.subagentId);
        if (failCreation.has(input.subagentId)) throw new Error("private create error");
        if (options.creationGate) await options.creationGate.wait(input.subagentId);
        const result = {
          childConversationId: `conversation-child-${input.subagentId}`,
          createdAt: timestamp,
        };
        return invalidCreation.has(input.subagentId)
          ? { ...result, privatePath: "/private/work" }
          : result;
      },
    },
    activationPort: {
      async activateChild(binding) {
        activated.push(binding.subagentId);
        if (failActivation.has(binding.subagentId)) throw new Error("private activation error");
      },
    },
    rollbackPort: {
      async rollbackChild(binding) {
        rolledBack.push(binding.subagentId);
        if (failRollback.has(binding.subagentId)) throw new Error("private rollback error");
      },
    },
    clock: { now: () => timestamp },
    logger,
  });
  return { manager, created, activated, rolledBack, logger };
}

async function expectFailure(promise, failure) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof ChildConversationManagerError, true);
    assert.equal(error.failure, failure);
    assert.equal(error.message, "Child Conversation management failed");
    assert.equal("cause" in error, false);
    return true;
  });
}

const happy = createHarness();
const running = await happy.manager.spawn(request("happy"));
assert.equal(running.status, SUBAGENT_STATUS.running);
assert.equal(running.depth, 1);
assert.equal(Object.isFrozen(running), true);
assert.deepEqual(happy.created, ["happy"]);
assert.deepEqual(happy.activated, ["happy"]);
assert.deepEqual(happy.manager.getCapacity("conversation-parent", "run-parent"), {
  activeGlobal: 1,
  activeForParentRun: 1,
});
const completed = await happy.manager.recordTerminalStatus("happy", "completed");
assert.equal(completed.status, SUBAGENT_STATUS.completed);
assert.deepEqual(happy.manager.getCapacity("conversation-parent", "run-parent"), {
  activeGlobal: 0,
  activeForParentRun: 0,
});
await expectFailure(
  happy.manager.recordTerminalStatus("happy", "failed"),
  CHILD_CONVERSATION_MANAGER_FAILURE.bindingAlreadyTerminal,
);

const nested = createHarness({ depthByParent: new Map([["conversation-child-parent", 1]]) });
await expectFailure(
  nested.manager.spawn(request("nested", { parentConversationId: "conversation-child-parent" })),
  CHILD_CONVERSATION_MANAGER_FAILURE.nestedSubagentForbidden,
);
assert.equal(nested.created.length, 0);

const expanded = createHarness();
await expectFailure(
  expanded.manager.spawn(request("expanded", { toolPolicyId: "policy-expanded" })),
  CHILD_CONVERSATION_MANAGER_FAILURE.toolPolicyExpansion,
);
assert.equal(expanded.created.length, 0);

const perRun = createHarness();
for (let index = 0; index < 4; index += 1) {
  await perRun.manager.spawn(request(`per-run-${index}`));
}
await expectFailure(
  perRun.manager.spawn(request("per-run-overflow")),
  CHILD_CONVERSATION_MANAGER_FAILURE.parentRunLimitExceeded,
);
await perRun.manager.recordTerminalStatus("per-run-0", "completed");
await perRun.manager.spawn(request("per-run-reused"));

const global = createHarness();
for (let index = 0; index < 16; index += 1) {
  await global.manager.spawn(request(`global-${index}`, {
    parentConversationId: `conversation-parent-${Math.floor(index / 4)}`,
    parentRunId: `run-parent-${Math.floor(index / 4)}`,
  }));
}
await expectFailure(
  global.manager.spawn(request("global-overflow", {
    parentConversationId: "conversation-parent-5",
    parentRunId: "run-parent-5",
  })),
  CHILD_CONVERSATION_MANAGER_FAILURE.globalLimitExceeded,
);

const failCreation = new Set(["create-fails"]);
const creationFailure = createHarness({ failCreation });
await expectFailure(
  creationFailure.manager.spawn(request("create-fails")),
  CHILD_CONVERSATION_MANAGER_FAILURE.childCreationFailed,
);
assert.equal(creationFailure.manager.getCapacity("conversation-parent", "run-parent").activeGlobal, 0);
failCreation.clear();
await creationFailure.manager.spawn(request("create-fails"));

const invalidCreation = createHarness({ invalidCreation: new Set(["invalid-create"]) });
await expectFailure(
  invalidCreation.manager.spawn(request("invalid-create")),
  CHILD_CONVERSATION_MANAGER_FAILURE.invalidChildCreation,
);
assert.equal(invalidCreation.manager.getCapacity("conversation-parent", "run-parent").activeGlobal, 0);

const activationFailure = createHarness({ failActivation: new Set(["activation-fails"]) });
await expectFailure(
  activationFailure.manager.spawn(request("activation-fails")),
  CHILD_CONVERSATION_MANAGER_FAILURE.childActivationFailed,
);
assert.deepEqual(activationFailure.rolledBack, ["activation-fails"]);
assert.equal(activationFailure.manager.getBinding("activation-fails").status, SUBAGENT_STATUS.failed);
assert.equal(activationFailure.manager.getCapacity("conversation-parent", "run-parent").activeGlobal, 0);

const rollbackFailure = createHarness({
  failActivation: new Set(["rollback-fails"]),
  failRollback: new Set(["rollback-fails"]),
});
await expectFailure(
  rollbackFailure.manager.spawn(request("rollback-fails")),
  CHILD_CONVERSATION_MANAGER_FAILURE.childRollbackFailed,
);
assert.equal(rollbackFailure.manager.getBinding("rollback-fails").status, SUBAGENT_STATUS.orphaned);

let releaseGate;
const gate = new Promise((resolve) => { releaseGate = resolve; });
let gatedCalls = 0;
const concurrent = createHarness({
  creationGate: {
    async wait() {
      gatedCalls += 1;
      await gate;
    },
  },
});
const pending = Array.from({ length: 4 }, (_, index) =>
  concurrent.manager.spawn(request(`concurrent-${index}`)),
);
while (gatedCalls < 4) await Promise.resolve();
await expectFailure(
  concurrent.manager.spawn(request("concurrent-overflow")),
  CHILD_CONVERSATION_MANAGER_FAILURE.parentRunLimitExceeded,
);
releaseGate();
await Promise.all(pending);

const serializedLogs = JSON.stringify([
  ...happy.logger.records,
  ...activationFailure.logger.records,
  ...rollbackFailure.logger.records,
]);
assert.equal(serializedLogs.includes("private objective"), false);
assert.equal(serializedLogs.includes("private create error"), false);
assert.equal(serializedLogs.includes("private activation error"), false);
assert.equal(serializedLogs.includes("private rollback error"), false);
assert.equal(serializedLogs.includes("/private"), false);

console.log("Runtime Subagent manager smoke passed");
