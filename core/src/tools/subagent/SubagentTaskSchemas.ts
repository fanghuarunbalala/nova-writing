/** TypeBox parameter Schemas for the PascalCase Subagent Tools. */
import { Type, type TObject, type TSchema } from "typebox";
import type { SubagentDefinitionReader } from "../../runtime/subagent/SubagentDefinitionCatalog.js";
import type { SubagentToolCompositionPolicy } from "../../runtime/subagent/SubagentTaskProtocol.js";
import { captureSubagentToolCompositionPolicy } from "../../runtime/subagent/SubagentTaskProtocolValidator.js";

export const SubagentTaskGetParametersSchema = Type.Object(
  { taskId: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false },
);

export const SubagentTaskCancelParametersSchema = SubagentTaskGetParametersSchema;

export function createSubagentTaskParametersSchema(options: {
  readonly definitions: SubagentDefinitionReader;
  readonly policy: SubagentToolCompositionPolicy;
}): TObject {
  const policy = captureSubagentToolCompositionPolicy(
    options.policy,
    options.definitions,
  );
  const agentTypes = policy.allowedAgentTypes.map((agentType) =>
    Type.Literal(agentType),
  );
  const agentTypeSchema: TSchema = agentTypes.length === 1
    ? agentTypes[0]
    : Type.Union(agentTypes);
  return Type.Object(
    {
      agentType: agentTypeSchema,
      prompt: Type.String({
        minLength: 1,
        maxLength: policy.limits.maximumPromptBytes,
      }),
      artifactIds: Type.Optional(Type.Array(
        Type.String({ minLength: 1, maxLength: 256 }),
        {
          maxItems: policy.limits.maximumArtifactReferences,
          uniqueItems: true,
        },
      )),
    },
    { additionalProperties: false },
  );
}
