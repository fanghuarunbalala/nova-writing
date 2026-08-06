/** Defines the TaskStop schema, descriptor, ownership checks, and cancellation-intent handler. */
import { Type } from "typebox";
import type { JsonValue } from "../../event/protocol/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { SubagentBindingStore } from "../../runtime/subagent/SubagentBindingStore.js";
import {
  SUBAGENT_CANCELLATION_REASON,
  SUBAGENT_STATUS,
  type SubagentBinding,
} from "../../runtime/subagent/SubagentProtocol.js";
import {
  SUBAGENT_TASK_CANCELLATION_STATUS,
  SUBAGENT_TASK_SCHEMA_VERSION,
  type SubagentTaskCancellation,
} from "../../runtime/subagent/SubagentTaskProtocol.js";
import {
  captureSubagentTaskCancellation,
  captureSubagentTaskCancelArguments,
} from "../../runtime/subagent/SubagentTaskProtocolValidator.js";
import { ToolError } from "../../runtime/tools/execution/index.js";
import {
  defineTool,
  type RegisteredTool,
  type ToolExecutionContext,
  type ToolResult,
} from "../../tooling/protocol/index.js";

export const SubagentTaskStopParametersSchema = Type.Object(
  { taskId: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false },
);

export const SubagentTaskCancelParametersSchema =
  SubagentTaskStopParametersSchema;

export type SubagentTaskCancellationIntentOutcome =
  | "cancellation_requested"
  | "already_terminal";

export interface SubagentTaskCancellationIntentPort {
  requestCancellation(
    binding: SubagentBinding,
    reason: typeof SUBAGENT_CANCELLATION_REASON.explicit,
  ): Promise<SubagentTaskCancellationIntentOutcome>;
}

export interface CreateTaskStopToolOptions {
  readonly bindings: SubagentBindingStore;
  readonly cancellation: SubagentTaskCancellationIntentPort;
  readonly logger?: Logger;
}

export function createTaskStopTool(
  options: CreateTaskStopToolOptions,
): RegisteredTool {
  const logger = (options.logger ?? noopLogger).child({
    component: "subagent_task_stop_tool",
  });
  return defineTool({
    descriptor: {
      name: "TaskStop",
      version: "1.0.0",
      label: "Task Stop",
      description: "Requests cancellation of one owned asynchronous Subagent Task without waiting for child Runtime termination.",
      parameters: SubagentTaskStopParametersSchema,
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
          throw taskStopFailure(context);
        }
        const cancellation = captureSubagentTaskCancellation({
          schemaVersion: SUBAGENT_TASK_SCHEMA_VERSION,
          taskId: binding.subagentId,
          status,
        });
        logger.info("runtime.subagent.task_stop_tool.completed", {
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

function taskCancellationResult(value: SubagentTaskCancellation): ToolResult {
  return Object.freeze({
    content: Object.freeze([Object.freeze({
      type: "text" as const,
      text: `Task ${value.taskId} cancellation status: ${value.status}.`,
    })]),
    details: value as unknown as JsonValue,
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

function taskStopFailure(context: ToolExecutionContext): ToolError {
  return new ToolError({
    code: "SUBAGENT_TASK_CANCEL_FAILED",
    category: "execution",
    retryable: true,
    sideEffectStatus: "possible",
    conversationId: context.conversationId,
    runId: context.runId,
    toolCallId: context.toolCallId,
    toolName: "TaskStop",
    toolVersion: "1.0.0",
  });
}

export type CreateTaskCancelToolOptions = CreateTaskStopToolOptions;

export const createTaskCancelTool = createTaskStopTool;
