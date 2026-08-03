/** Defines the dynamic Task schema, descriptor, and asynchronous Subagent bootstrap handler. */
import { Type, type TObject, type TSchema } from "typebox";
import type { JsonValue } from "../../event/protocol/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { ArtifactReference } from "../../storage/artifact/index.js";
import type { ChildConversationManager } from "../../runtime/subagent/ChildConversationManagerProtocol.js";
import type { SubagentDefinitionReader } from "../../runtime/subagent/SubagentDefinitionCatalog.js";
import {
  SUBAGENT_SCHEMA_VERSION,
  SUBAGENT_STATUS,
} from "../../runtime/subagent/SubagentProtocol.js";
import {
  SUBAGENT_TASK_SCHEMA_VERSION,
  type SubagentTaskAcceptance,
  type SubagentToolCompositionPolicy,
} from "../../runtime/subagent/SubagentTaskProtocol.js";
import {
  captureSubagentTaskAcceptance,
  captureSubagentTaskArguments,
  captureSubagentToolCompositionPolicy,
} from "../../runtime/subagent/SubagentTaskProtocolValidator.js";
import { ToolError } from "../../runtime/tools/execution/index.js";
import {
  defineTool,
  type RegisteredTool,
  type ToolExecutionContext,
  type ToolResult,
} from "../../tooling/protocol/index.js";

export interface SubagentTaskIdFactory {
  create(context: ToolExecutionContext): string;
}

export interface SubagentTaskClock {
  now(): string;
}

export interface SubagentTaskArtifactResolver {
  resolve(
    parentConversationId: string,
    artifactIds: readonly string[],
  ): Promise<readonly ArtifactReference[]>;
}

export interface CreateTaskToolOptions {
  readonly definitions: SubagentDefinitionReader;
  readonly policy: SubagentToolCompositionPolicy;
  readonly manager: ChildConversationManager;
  readonly artifactResolver: SubagentTaskArtifactResolver;
  readonly taskIdFactory?: SubagentTaskIdFactory;
  readonly clock?: SubagentTaskClock;
  readonly logger?: Logger;
}

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

export function createTaskTool(options: CreateTaskToolOptions): RegisteredTool {
  const policy = captureSubagentToolCompositionPolicy(
    options.policy,
    options.definitions,
  );
  const parameters = createSubagentTaskParametersSchema({
    definitions: options.definitions,
    policy,
  });
  const taskIdFactory = options.taskIdFactory ?? RANDOM_SUBAGENT_TASK_ID_FACTORY;
  const clock = options.clock ?? SYSTEM_SUBAGENT_TASK_CLOCK;
  const logger = (options.logger ?? noopLogger).child({
    component: "subagent_task_tool",
  });

  return defineTool({
    descriptor: {
      name: "Task",
      version: "1.0.0",
      label: "Task",
      description: createTaskDescription(options.definitions, policy),
      parameters,
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        const captured = captureSubagentTaskArguments(arguments_, {
          definitions: options.definitions,
          policy,
        });
        const definition = options.definitions.require(captured.agentType);
        const taskId = taskIdFactory.create(context);
        let artifactReferences: readonly ArtifactReference[];
        try {
          artifactReferences = await options.artifactResolver.resolve(
            context.conversationId,
            captured.artifactIds ?? [],
          );
        } catch {
          throw taskFailure(
            context,
            "SUBAGENT_ARTIFACT_RESOLUTION_FAILED",
            false,
            "none",
          );
        }
        context.signal.throwIfAborted();
        try {
          const binding = await options.manager.spawn({
            schemaVersion: SUBAGENT_SCHEMA_VERSION,
            subagentId: taskId,
            parentConversationId: context.conversationId,
            parentRunId: context.runId,
            ...(context.turnId === undefined ? {} : { parentTurnId: context.turnId }),
            agentType: definition.agentType,
            definitionVersion: definition.definitionVersion,
            objective: captured.prompt,
            toolPolicyId: definition.toolPolicyId,
            ...(artifactReferences.length === 0 ? {} : { artifactReferences }),
            requestedAt: clock.now(),
          });
          const acceptance = captureSubagentTaskAcceptance({
            schemaVersion: SUBAGENT_TASK_SCHEMA_VERSION,
            taskId: binding.subagentId,
            childConversationId: binding.childConversationId,
            status: binding.status === SUBAGENT_STATUS.creating ? "queued" : "running",
            acceptedAt: binding.updatedAt,
          });
          logger.info("runtime.subagent.task_tool.accepted", {
            taskId: acceptance.taskId,
            childConversationId: acceptance.childConversationId,
            parentConversationId: context.conversationId,
            parentRunId: context.runId,
            agentType: definition.agentType,
            artifactCount: artifactReferences.length,
            status: acceptance.status,
          });
          return taskAcceptanceResult(acceptance);
        } catch (error) {
          if (error instanceof ToolError) throw error;
          logger.info("runtime.subagent.task_tool.failed", {
            taskId,
            parentConversationId: context.conversationId,
            parentRunId: context.runId,
            agentType: definition.agentType,
          });
          throw taskFailure(
            context,
            "SUBAGENT_TASK_CREATE_FAILED",
            false,
            "possible",
          );
        }
      },
    },
  });
}

function createTaskDescription(
  definitions: SubagentDefinitionReader,
  policy: SubagentToolCompositionPolicy,
): string {
  const lines = policy.allowedAgentTypes.map((agentType) => {
    const definition = definitions.require(agentType);
    return `- ${definition.agentType} (${definition.label}): ${definition.description}`;
  });
  return [
    "Starts one asynchronous ephemeral Subagent and returns after durable Task assignment and activation acceptance.",
    "The prompt must be self-contained because parent context is not inherited.",
    "Allowed agent types:",
    ...lines,
  ].join("\n");
}

function taskAcceptanceResult(value: SubagentTaskAcceptance): ToolResult {
  return Object.freeze({
    content: Object.freeze([Object.freeze({
      type: "text" as const,
      text: `Task ${value.taskId} accepted with status ${value.status}.`,
    })]),
    details: value as unknown as JsonValue,
  });
}

function taskFailure(
  context: ToolExecutionContext,
  code: string,
  retryable: boolean,
  sideEffectStatus: "none" | "possible",
): ToolError {
  return new ToolError({
    code,
    category: "execution",
    retryable,
    sideEffectStatus,
    conversationId: context.conversationId,
    runId: context.runId,
    toolCallId: context.toolCallId,
    toolName: "Task",
    toolVersion: "1.0.0",
  });
}

const RANDOM_SUBAGENT_TASK_ID_FACTORY: SubagentTaskIdFactory = Object.freeze({
  create(): string {
    return `task_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
  },
});

const SYSTEM_SUBAGENT_TASK_CLOCK: SubagentTaskClock = Object.freeze({
  now(): string {
    return new Date().toISOString();
  },
});
