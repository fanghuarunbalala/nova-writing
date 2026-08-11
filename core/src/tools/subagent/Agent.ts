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
    const toolList = definition.tools === undefined
      ? ""
      : `\n  （工具：${definition.tools.join("、")}）`;
    return `- ${definition.agentType}（${definition.label}）：${definition.description}${toolList}`;
  });
  return [
    "启动一个异步临时子代理，任务持久登记并确认激活后即返回；子代理自主处理复杂多步任务。",
    "",
    "允许的子代理类型：",
    ...lines,
    "",
    "用法：",
    "- agentType 从上方选择；prompt 必须自包含——子代理不继承父会话上下文，请把目标、背景与已排除的选项写全，让它能自行判断。",
    "- 返回的 taskId 用于 TaskOutput 轮询结果、TaskStop 取消；完成后子代理返回一条消息，结果用户不可见，请向用户转述要点。",
    "",
    "如何写 prompt（像对刚进门的同事交代：它没看过这段对话、不知道你试过什么、不明白为什么重要）：",
    "- 说明要达成什么、为什么、已试过/排除过什么，给足上下文让子代理做判断。",
    "- 需要简短回答就直接说（如\"200 字以内\"）。",
    "- 具体查找给精确指令；开放式调查给问题——步骤写死反而碍事。",
    "- 不要外包理解：不要写\"基于你的发现去改\"，要写出你已理解的（具体章节/段落/行号、改什么）。",
    "",
    "何时不用：",
    "- 只想读取具体内容（某章节/人物/段落）时，直接用对应的 Novel 读工具或 Read/Glob，更快。",
    "- 任务简单到可以直接自己完成时，不必另起子代理。",
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
