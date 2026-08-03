import assert from "node:assert/strict";
import {
  CHILD_CONVERSATION_MANAGER_FAILURE,
  ChildConversationManagerError,
  DefaultChildConversationManager,
  SUBAGENT_SCHEMA_VERSION,
  SUBAGENT_STATUS,
  SUBAGENT_TOOL_POLICY_RELATION,
} from "../dist/index.js";

const timestamp = "2026-08-03T00:00:00.000Z";

function request(subagentId) {
  return {
    schemaVersion: SUBAGENT_SCHEMA_VERSION,
    subagentId,
    parentConversationId: "conversation-parent",
    parentRunId: "run-parent",
    parentTurnId: "turn-parent",
    agentType: "novel_planner",
    definitionVersion: "1.0.0",
    objective: "Plan the next chapter.",
    toolPolicyId: "policy-child",
    requestedAt: timestamp,
  };
}

function createHarness(options = {}) {
  const order = [];
  const manager = new DefaultChildConversationManager({
    parentScopeReader: {
      async readParentScope(input) {
        return {
          parentConversationId: input.parentConversationId,
          parentRunId: input.parentRunId,
          workspaceId: "workspace-main",
          depth: 0,
          toolPolicyId: "policy-parent",
        };
      },
    },
    toolPolicyRelationReader: {
      async readRelation() {
        return SUBAGENT_TOOL_POLICY_RELATION.reduced;
      },
    },
    creationPort: {
      async createChild(input) {
        order.push(`create:${input.subagentId}`);
        return {
          childConversationId: `conversation-child-${input.subagentId}`,
          createdAt: timestamp,
        };
      },
    },
    taskAssignmentPort: {
      async assignTask(binding) {
        order.push(`assign:${binding.subagentId}`);
        if (options.failAssignment) throw new Error("private assignment failure");
        return {
          status: "accepted",
          conversationId: binding.childConversationId,
          inputEventId: `task-assigned-${binding.subagentId}`,
          sequence: 1,
          acceptedAt: timestamp,
        };
      },
    },
    bindingPersistencePort: {
      async persist(binding) {
        order.push(`persist:${binding.status}`);
      },
    },
    activationPort: {
      async activateChild(binding) {
        order.push(`activate:${binding.subagentId}`);
      },
    },
    rollbackPort: {
      async rollbackChild(binding) {
        order.push(`rollback:${binding.subagentId}`);
      },
    },
    clock: { now: () => timestamp },
  });
  return { manager, order };
}

const happy = createHarness();
const firstRequest = request("task-1");
const first = await happy.manager.spawn(firstRequest);
assert.equal(first.status, SUBAGENT_STATUS.running);
assert.deepEqual(happy.order, [
  "create:task-1",
  "persist:creating",
  "assign:task-1",
  "activate:task-1",
  "persist:running",
]);

const retry = await happy.manager.spawn(firstRequest);
assert.equal(retry.childConversationId, first.childConversationId);
assert.deepEqual(happy.order, [
  "create:task-1",
  "persist:creating",
  "assign:task-1",
  "activate:task-1",
  "persist:running",
]);

const failed = createHarness({ failAssignment: true });
await assert.rejects(
  failed.manager.spawn(request("task-failed")),
  (error) => error instanceof ChildConversationManagerError &&
    error.failure === CHILD_CONVERSATION_MANAGER_FAILURE.childTaskAssignmentFailed,
);
assert.deepEqual(failed.order, [
  "create:task-failed",
  "persist:creating",
  "assign:task-failed",
  "rollback:task-failed",
  "persist:failed",
]);
assert.equal(failed.manager.getBinding("task-failed").status, SUBAGENT_STATUS.failed);
assert.equal(failed.manager.getCapacity("conversation-parent", "run-parent").activeGlobal, 0);

console.log("runtime Subagent Bootstrap smoke passed");
