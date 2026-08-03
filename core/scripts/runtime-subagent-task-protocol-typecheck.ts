/** Compile-time usage example for dynamically constrained Subagent Task parameters. */
import {
  SubagentDefinitionCatalog,
  captureSubagentToolCompositionPolicy,
  createSubagentTaskParametersSchema,
  type SubagentTaskArguments,
} from "../src/index.js";

const definitions = new SubagentDefinitionCatalog([
  {
    agentType: "novel_planner",
    definitionVersion: "1.0.0",
    label: "Novel planner",
    description: "Plans a bounded novel-writing task.",
    toolPolicyId: "policy.novel_planner",
  },
]);
const policy = captureSubagentToolCompositionPolicy({
  allowedAgentTypes: ["novel_planner"],
  limits: {
    maximumPromptBytes: 16_384,
    maximumArtifactReferences: 8,
    maximumResultBytes: 16_384,
  },
}, definitions);
const schema = createSubagentTaskParametersSchema({ definitions, policy });
const arguments_: SubagentTaskArguments = {
  agentType: "novel_planner",
  prompt: "Plan the next chapter.",
};

void schema;
void arguments_;
