/** Defines the TaskGet schema, descriptor, and process-free Subagent query handler. */
import { Type } from "typebox";
import type { JsonValue } from "../../event/protocol/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type {
  SubagentTaskSnapshot,
} from "../../runtime/subagent/SubagentTaskProtocol.js";
import { captureSubagentTaskGetArguments } from "../../runtime/subagent/SubagentTaskProtocolValidator.js";
import type { SubagentTaskQueryService } from "../../runtime/subagent/SubagentTaskQueryService.js";
import { ToolError } from "../../runtime/tools/execution/index.js";
import {
  defineTool,
  type RegisteredTool,
  type ToolExecutionContext,
  type ToolResult,
} from "../../tooling/protocol/index.js";

export const SubagentTaskGetParametersSchema = Type.Object(
  { taskId: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false },
);

export interface CreateTaskGetToolOptions {
  readonly query: SubagentTaskQueryService;
  readonly logger?: Logger;
}

export function createTaskGetTool(
  options: CreateTaskGetToolOptions,
): RegisteredTool {
  const logger = (options.logger ?? noopLogger).child({
    component: "subagent_task_get_tool",
  });
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
          throw taskGetFailure(
            context,
            "SUBAGENT_TASK_QUERY_FAILED",
            true,
          );
        }
        if (snapshot === undefined) {
          throw taskGetFailure(
            context,
            "SUBAGENT_TASK_NOT_FOUND",
            false,
          );
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

function taskSnapshotResult(value: SubagentTaskSnapshot): ToolResult {
  return Object.freeze({
    content: Object.freeze([Object.freeze({
      type: "text" as const,
      text: value.result === undefined
        ? `Task ${value.taskId} is ${value.status}.`
        : `Task ${value.taskId} completed and its result is available in details.`,
    })]),
    details: value as unknown as JsonValue,
  });
}

function taskGetFailure(
  context: ToolExecutionContext,
  code: string,
  retryable: boolean,
): ToolError {
  return new ToolError({
    code,
    category: "execution",
    retryable,
    sideEffectStatus: "none",
    conversationId: context.conversationId,
    runId: context.runId,
    toolCallId: context.toolCallId,
    toolName: "TaskGet",
    toolVersion: "1.0.0",
  });
}
