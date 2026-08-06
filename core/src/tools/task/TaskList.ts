/** Defines the TaskList schema, descriptor, and handler. */
import { Type } from "typebox";
import type { JsonObject } from "../../event/protocol/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  type TaskListResolver,
  type WorkItemListQuerier,
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

export const TaskListParametersSchema = Type.Object(
  {
    status: Type.Optional(
      Type.Union([
        Type.Literal("pending"),
        Type.Literal("in_progress"),
        Type.Literal("completed"),
      ]),
    ),
    owner: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false },
);

export interface TaskListDetails extends JsonObject {
  readonly total: number;
  readonly tasks: JsonObject[];
}

export interface CreateWorkItemTaskListToolOptions {
  readonly querier: WorkItemListQuerier;
  readonly resolver?: TaskListResolver;
  readonly logger?: Logger;
}

export function createWorkItemTaskListTool(
  options: CreateWorkItemTaskListToolOptions,
): RegisteredTool<typeof TaskListParametersSchema, TaskListDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "task_list_tool",
  });
  const resolver = options.resolver ?? defaultTaskResolver();
  return defineTool({
    descriptor: {
      name: "TaskList",
      version: "1.0.0",
      label: "Task List",
      description:
        "Lists work items in the caller's task list, excluding deleted items unless filtered.",
      parameters: TaskListParametersSchema,
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        const listId = await resolveTaskList(context, resolver);
        let tasks;
        try {
          tasks = await options.querier.list(listId, {
            ...(arguments_.status === undefined
              ? {}
              : { status: arguments_.status }),
            ...(arguments_.owner === undefined
              ? {}
              : { owner: arguments_.owner }),
          });
        } catch {
          throw taskToolFailure(
            context,
            "TASK_LIST_FAILED",
            true,
            "TaskList",
            "1.0.0",
          );
        }
        context.signal.throwIfAborted();
        logger.info("runtime.task.tool_listed", {
          conversationId: context.conversationId,
          listId,
          runId: context.runId,
          toolCallId: context.toolCallId,
          total: tasks.length,
        });
        return Object.freeze({
          content: Object.freeze([
            Object.freeze({
              type: "text" as const,
              text: `${tasks.length} task(s).`,
            }),
          ]),
          details: Object.freeze({
            total: tasks.length,
            tasks: tasks.map(workItemToJson),
          }),
        });
      },
    },
  });
}
