/** Builds the provider-neutral PascalCase Tools for asynchronous ephemeral Subagents. */
import type { JsonValue } from "../../event/protocol/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { ArtifactReference } from "../../storage/artifact/index.js";
import { ToolError } from "../../tools/execution/index.js";
import {
  defineTool,
  type RegisteredTool,
  type ToolExecutionContext,
  type ToolResult,
} from "../../tools/protocol/index.js";
import { ToolRegistry } from "../../tools/registry/index.js";
import type { SubagentBindingStore } from "./SubagentBindingStore.js";
import type { ChildConversationManager } from "./ChildConversationManagerProtocol.js";
import type { SubagentDefinitionReader } from "./SubagentDefinitionCatalog.js";
import {
  SUBAGENT_CANCELLATION_REASON,
  SUBAGENT_SCHEMA_VERSION,
  SUBAGENT_STATUS,
  type SubagentBinding,
} from "./SubagentProtocol.js";
import {
  SUBAGENT_TASK_CANCELLATION_STATUS,
  SUBAGENT_TASK_SCHEMA_VERSION,
  type SubagentTaskAcceptance,
  type SubagentTaskArguments,
  type SubagentTaskCancellation,
  type SubagentTaskCancelArguments,
  type SubagentTaskGetArguments,
  type SubagentTaskSnapshot,
  type SubagentToolCompositionPolicy,
} from "./SubagentTaskProtocol.js";
import {
  captureSubagentTaskAcceptance,
  captureSubagentTaskArguments,
  captureSubagentTaskCancellation,
  captureSubagentTaskCancelArguments,
  captureSubagentTaskGetArguments,
  captureSubagentToolCompositionPolicy,
} from "./SubagentTaskProtocolValidator.js";
import {
  createSubagentTaskParametersSchema,
  SubagentTaskCancelParametersSchema,
  SubagentTaskGetParametersSchema,
} from "./SubagentTaskSchemas.js";
import type { SubagentTaskQueryService } from "./SubagentTaskQueryService.js";

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

export type SubagentTaskCancellationIntentOutcome =
  | "cancellation_requested"
  | "already_terminal";

export interface SubagentTaskCancellationIntentPort {
  requestCancellation(
    binding: SubagentBinding,
    reason: typeof SUBAGENT_CANCELLATION_REASON.explicit,
  ): Promise<SubagentTaskCancellationIntentOutcome>;
}

export interface SubagentTaskToolRegistryOptions {
  readonly definitions: SubagentDefinitionReader;
  readonly policy: SubagentToolCompositionPolicy;
  readonly manager: ChildConversationManager;
  readonly bindings: SubagentBindingStore;
  readonly query: SubagentTaskQueryService;
  readonly artifactResolver: SubagentTaskArtifactResolver;
  readonly cancellation: SubagentTaskCancellationIntentPort;
  readonly taskIdFactory?: SubagentTaskIdFactory;
  readonly clock?: SubagentTaskClock;
  readonly logger?: Logger;
}

export function createSubagentTaskToolRegistry(
  options: SubagentTaskToolRegistryOptions,
): ToolRegistry {
  const composition = captureSubagentToolCompositionPolicy(
    options.policy,
    options.definitions,
  );
  const logger = (options.logger ?? noopLogger).child({
    component: "subagent_task_tools",
  });
  const taskIdFactory = options.taskIdFactory ?? RANDOM_SUBAGENT_TASK_ID_FACTORY;
  const clock = options.clock ?? SYSTEM_SUBAGENT_TASK_CLOCK;

  return new ToolRegistry([
    createTaskTool(options, composition, taskIdFactory, clock, logger),
    createTaskGetTool(options, logger),
    createTaskCancelTool(options, logger),
  ]);
}

function createTaskTool(
  options: SubagentTaskToolRegistryOptions,
  policy: SubagentToolCompositionPolicy,
  taskIdFactory: SubagentTaskIdFactory,
  clock: SubagentTaskClock,
  logger: Logger,
): RegisteredTool {
  const parameters = createSubagentTaskParametersSchema({
    definitions: options.definitions,
    policy,
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
          throw toolFailure(context, "Task", "SUBAGENT_ARTIFACT_RESOLUTION_FAILED", false, "none");
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
          throw toolFailure(context, "Task", "SUBAGENT_TASK_CREATE_FAILED", false, "possible");
        }
      },
    },
  });
}

function createTaskGetTool(
  options: SubagentTaskToolRegistryOptions,
  logger: Logger,
): RegisteredTool {
  return defineTool({
    descriptor: {
      name: "TaskGet",
      version: "1.0.0",
      label: "Task Get",
      description: "Reads one asynchronous Subagent Task status and its final result without activating the child Runtime.",
      parameters: SubagentTaskGetParametersSchema,
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        const captured = captureSubagentTaskGetArguments(arguments_);
        let snapshot: SubagentTaskSnapshot | undefined;
        try {
          snapshot = await options.query.get({
            parentConversationId: context.conversationId,
            parentRunId: context.runId,
            taskId: captured.taskId,
          });
        } catch {
          throw toolFailure(context, "TaskGet", "SUBAGENT_TASK_QUERY_FAILED", true, "none");
        }
        if (snapshot === undefined) {
          throw toolFailure(context, "TaskGet", "SUBAGENT_TASK_NOT_FOUND", false, "none");
        }
        logger.debug("runtime.subagent.task_get_tool.completed", {
          taskId: snapshot.taskId,
          parentConversationId: context.conversationId,
          parentRunId: context.runId,
          status: snapshot.status,
          runtimePresence: snapshot.runtimePresence,
          hasResult: snapshot.result !== undefined,
        });
        return taskSnapshotResult(snapshot);
      },
    },
  });
}

function createTaskCancelTool(
  options: SubagentTaskToolRegistryOptions,
  logger: Logger,
): RegisteredTool {
  return defineTool({
    descriptor: {
      name: "TaskCancel",
      version: "1.0.0",
      label: "Task Cancel",
      description: "Requests cancellation of one owned asynchronous Subagent Task without waiting for child Runtime termination.",
      parameters: SubagentTaskCancelParametersSchema,
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        const captured = captureSubagentTaskCancelArguments(arguments_);
        const binding = await options.bindings.get(captured.taskId);
        if (!ownsTask(binding, context)) {
          return taskCancellationResult(captureSubagentTaskCancellation({
            schemaVersion: SUBAGENT_TASK_SCHEMA_VERSION,
            taskId: captured.taskId,
            status: SUBAGENT_TASK_CANCELLATION_STATUS.notFound,
          }));
        }
        if (isTerminal(binding.status)) {
          return taskCancellationResult(captureSubagentTaskCancellation({
            schemaVersion: SUBAGENT_TASK_SCHEMA_VERSION,
            taskId: binding.subagentId,
            status: SUBAGENT_TASK_CANCELLATION_STATUS.alreadyTerminal,
          }));
        }
        let status: SubagentTaskCancellationIntentOutcome;
        try {
          status = await options.cancellation.requestCancellation(
            binding,
            SUBAGENT_CANCELLATION_REASON.explicit,
          );
        } catch {
          throw toolFailure(context, "TaskCancel", "SUBAGENT_TASK_CANCEL_FAILED", true, "possible");
        }
        const cancellation = captureSubagentTaskCancellation({
          schemaVersion: SUBAGENT_TASK_SCHEMA_VERSION,
          taskId: binding.subagentId,
          status,
        });
        logger.info("runtime.subagent.task_cancel_tool.completed", {
          taskId: cancellation.taskId,
          parentConversationId: context.conversationId,
          parentRunId: context.runId,
          status: cancellation.status,
        });
        return taskCancellationResult(cancellation);
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
  return toolResult(
    `Task ${value.taskId} accepted with status ${value.status}.`,
    value,
  );
}

function taskSnapshotResult(value: SubagentTaskSnapshot): ToolResult {
  return toolResult(
    value.result === undefined
      ? `Task ${value.taskId} is ${value.status}.`
      : `Task ${value.taskId} completed and its result is available in details.`,
    value,
  );
}

function taskCancellationResult(value: SubagentTaskCancellation): ToolResult {
  return toolResult(`Task ${value.taskId} cancellation status: ${value.status}.`, value);
}

function toolResult(text: string, details: object): ToolResult {
  return Object.freeze({
    content: Object.freeze([Object.freeze({ type: "text" as const, text })]),
    details: details as JsonValue,
  });
}

function ownsTask(
  binding: SubagentBinding | undefined,
  context: ToolExecutionContext,
): binding is SubagentBinding {
  return binding !== undefined &&
    binding.parentConversationId === context.conversationId &&
    binding.parentRunId === context.runId;
}

function isTerminal(status: SubagentBinding["status"]): boolean {
  return status === SUBAGENT_STATUS.completed ||
    status === SUBAGENT_STATUS.failed ||
    status === SUBAGENT_STATUS.cancelled ||
    status === SUBAGENT_STATUS.orphaned;
}

function toolFailure(
  context: ToolExecutionContext,
  toolName: "Task" | "TaskGet" | "TaskCancel",
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
    toolName,
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
