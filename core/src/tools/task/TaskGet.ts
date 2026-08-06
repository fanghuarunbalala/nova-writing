/** Defines the TaskGet schema, descriptor, and handler. */
import { Type } from "typebox";
import type { JsonObject } from "../../event/protocol/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  type TaskListResolver,
  type WorkItemListQuerier,
  type WorkItemSnapshot,
} from "../../runtime/task/TaskProtocol.js";
import {
  defineTool,
  type RegisteredTool,
  type ToolResult,
} from "../../tooling/protocol/index.js";
import {
  defaultTaskResolver,
  resolveTaskList,
  taskToolFailure,
  workItemToJson,
} from "./TaskToolHelpers.js";

export const TaskGetParametersSchema = Type.Object(
  {
    taskId: Type.String({
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
    }),
  },
  { additionalProperties: false },
);

export interface TaskGetDetails extends JsonObject {
  readonly task: JsonObject;
}

export interface CreateWorkItemTaskGetToolOptions {
  readonly querier: WorkItemListQuerier;
  readonly resolver?: TaskListResolver;
  readonly logger?: Logger;
}

export function createWorkItemTaskGetTool(
  options: CreateWorkItemTaskGetToolOptions,
): RegisteredTool<typeof TaskGetParametersSchema, TaskGetDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "task_get_tool",
  });
  const resolver = options.resolver ?? defaultTaskResolver();
  return defineTool({
    descriptor: {
      name: "TaskGet",
      version: "1.0.0",
      label: "Task Get",
      description:
        "Reads one work item from the caller's task list by ID.",
      parameters: TaskGetParametersSchema,
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        const listId = await resolveTaskList(context, resolver);
        let task: WorkItemSnapshot | undefined;
        try {
          task = await options.querier.get(listId, arguments_.taskId);
        } catch {
          throw taskToolFailure(
            context,
            "TASK_GET_FAILED",
            true,
            "TaskGet",
            "1.0.0",
          );
        }
        context.signal.throwIfAborted();
        if (task === undefined) {
          throw taskToolFailure(
            context,
            "TASK_NOT_FOUND",
            false,
            "TaskGet",
            "1.0.0",
          );
        }
        logger.info("runtime.task.tool_get", {
          conversationId: context.conversationId,
          listId,
          runId: context.runId,
          toolCallId: context.toolCallId,
          taskId: task.id,
          status: task.status,
        });
        return taskResult(task);
      },
    },
  });
}

function taskResult(task: WorkItemSnapshot): ToolResult<TaskGetDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({
        type: "text" as const,
        text: `Task ${task.id}: ${task.subject}`,
      }),
    ]),
    details: Object.freeze({ task: workItemToJson(task) }),
  });
}
