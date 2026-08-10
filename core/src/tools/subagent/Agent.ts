/** Defines the dynamic Agent schema, descriptor, and asynchronous Subagent bootstrap handler. */
import { Type, type TObject, type TSchema } from "typebox";
import type { JsonValue } from "../../event/protocol/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
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

export interface CreateAgentToolOptions {
  readonly definitions: SubagentDefinitionReader;
  readonly policy: SubagentToolCompositionPolicy;
  readonly manager: ChildConversationManager;
  readonly taskIdFactory?: SubagentTaskIdFactory;
  readonly clock?: SubagentTaskClock;
  readonly logger?: Logger;
}

export function createAgentParametersSchema(options: {
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
    },
    { additionalProperties: false },
  );
}

export const createSubagentTaskParametersSchema = createAgentParametersSchema;

export function createAgentTool(options: CreateAgentToolOptions): RegisteredTool {
  const policy = captureSubagentToolCompositionPolicy(
    options.policy,
    options.definitions,
  );
  const parameters = createAgentParametersSchema({
    definitions: options.definitions,
    policy,
  });
  const taskIdFactory = options.taskIdFactory ?? RANDOM_SUBAGENT_TASK_ID_FACTORY;
  const clock = options.clock ?? SYSTEM_SUBAGENT_TASK_CLOCK;
  const logger = (options.logger ?? noopLogger).child({
    component: "subagent_agent_tool",
  });

  return defineTool({
    descriptor: {
      name: "Agent",
      version: "1.0.0",
      label: "Agent",
      description: createAgentDescription(options.definitions, policy),
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

function createAgentDescription(
  definitions: SubagentDefinitionReader,
  policy: SubagentToolCompositionPolicy,
): string {
  const lines = policy.allowedAgentTypes.map((agentType) => {
    const definition = definitions.require(agentType);
    return `- ${definition.agentType}（${definition.label}）：${definition.description}`;
  });
  return [
    "启动一个异步临时子代理，任务持久登记并确认激活后即返回。",
    "用法：",
    "- prompt 必须自包含：子代理不继承父会话上下文，请把目标与所需信息写全。",
    "- agentType 从下方允许类型中选择；用返回的 taskId 通过 TaskOutput 轮询结果、TaskStop 取消。",
    "允许的子代理类型：",
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
