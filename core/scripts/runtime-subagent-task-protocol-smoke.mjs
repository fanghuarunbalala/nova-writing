import assert from "node:assert/strict";
import { Compile } from "typebox/compile";
import {
  SUBAGENT_TASK_PROTOCOL_FAILURE,
  SUBAGENT_TASK_SCHEMA_VERSION,
  SubagentDefinitionCatalog,
  SubagentTaskProtocolError,
  captureSubagentTaskAcceptance,
  captureSubagentTaskArguments,
  captureSubagentTaskCancellation,
  captureSubagentTaskSnapshot,
  captureSubagentToolCompositionPolicy,
  createSubagentTaskParametersSchema,
} from "../dist/index.js";

const definitions = new SubagentDefinitionCatalog([
  definition("novel_reviewer", "Reviews bounded novel content."),
  definition("novel_planner", "Plans bounded novel work."),
]);
assert.deepEqual(definitions.list().map((value) => value.agentType), [
  "novel_planner",
  "novel_reviewer",
]);
assert.equal(Object.isFrozen(definitions.list()), true);
assert.equal(definitions.require("novel_planner").definitionVersion, "1.0.0");
assertFailure(
  () => definitions.require("missing_type"),
  SUBAGENT_TASK_PROTOCOL_FAILURE.unknownDefinition,
);
assertFailure(
  () => new SubagentDefinitionCatalog([
    definition("novel_planner", "First."),
    definition("novel_planner", "Second."),
  ]),
  SUBAGENT_TASK_PROTOCOL_FAILURE.duplicateDefinition,
);

const policy = captureSubagentToolCompositionPolicy({
  allowedAgentTypes: ["novel_reviewer", "novel_planner"],
  limits: {
    maximumPromptBytes: 32,
    maximumArtifactReferences: 2,
    maximumResultBytes: 64,
  },
}, definitions);
assert.deepEqual(policy.allowedAgentTypes, ["novel_planner", "novel_reviewer"]);
assert.equal(Object.isFrozen(policy.allowedAgentTypes), true);

const schema = createSubagentTaskParametersSchema({ definitions, policy });
const check = Compile(schema);
assert.equal(check.Check({ agentType: "novel_planner", prompt: "Plan." }), true);
assert.equal(check.Check({ agentType: "unknown", prompt: "Plan." }), false);
assert.equal(check.Check({
  agentType: "novel_planner",
  prompt: "Plan.",
  artifactIds: ["artifact-1", "artifact-1"],
}), false);

const arguments_ = captureSubagentTaskArguments({
  agentType: "novel_planner",
  prompt: "Plan the next chapter.",
  artifactIds: ["artifact-1"],
}, { definitions, policy });
assert.equal(Object.isFrozen(arguments_), true);
assert.equal(Object.isFrozen(arguments_.artifactIds), true);
assertFailure(
  () => captureSubagentTaskArguments({
    agentType: "novel_planner",
    prompt: "x".repeat(33),
  }, { definitions, policy }),
  SUBAGENT_TASK_PROTOCOL_FAILURE.invalidArguments,
);
assertFailure(
  () => captureSubagentTaskArguments({
    agentType: "novel_reviewer",
    prompt: "Review.",
    artifactIds: ["a", "b", "c"],
  }, { definitions, policy }),
  SUBAGENT_TASK_PROTOCOL_FAILURE.invalidArguments,
);

const acceptance = captureSubagentTaskAcceptance({
  schemaVersion: SUBAGENT_TASK_SCHEMA_VERSION,
  taskId: "task-1",
  childConversationId: "conversation-child-1",
  status: "running",
  acceptedAt: "2026-08-03T00:00:00.000Z",
});
assert.equal(Object.isFrozen(acceptance), true);

const snapshot = captureSubagentTaskSnapshot({
  schemaVersion: SUBAGENT_TASK_SCHEMA_VERSION,
  taskId: "task-1",
  childConversationId: "conversation-child-1",
  status: "completed",
  runtimePresence: "absent",
  result: {
    content: "Completed result.",
    artifactReferences: [],
  },
}, policy.limits);
assert.equal(Object.isFrozen(snapshot.result), true);
assert.equal(Object.isFrozen(snapshot.result.artifactReferences), true);

const cancellation = captureSubagentTaskCancellation({
  schemaVersion: SUBAGENT_TASK_SCHEMA_VERSION,
  taskId: "task-1",
  status: "cancellation_requested",
});
assert.equal(Object.isFrozen(cancellation), true);

const privatePrompt = "DO_NOT_EXPOSE_SUBAGENT_PROMPT";
assert.throws(
  () => captureSubagentTaskArguments({
    agentType: "novel_planner",
    prompt: privatePrompt.repeat(8),
  }, { definitions, policy }),
  (error) => error instanceof SubagentTaskProtocolError &&
    !String(error).includes(privatePrompt) &&
    !JSON.stringify(error).includes(privatePrompt),
);

console.log("runtime Subagent Task protocol smoke passed");

function definition(agentType, description) {
  return {
    agentType,
    definitionVersion: "1.0.0",
    label: agentType,
    description,
    toolPolicyId: `policy.${agentType}`,
  };
}

function assertFailure(operation, failure) {
  assert.throws(
    operation,
    (error) => error instanceof SubagentTaskProtocolError &&
      error.failure === failure,
  );
}
