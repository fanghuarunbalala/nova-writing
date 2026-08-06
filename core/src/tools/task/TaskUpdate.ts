/** Defines the TaskUpdate schema, descriptor, and handler. */
import { Type } from "typebox";
import type { JsonObject } from "../../event/protocol/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  WorkItemNotFoundError,
} from "../../runtime/task/TaskProtocol.js";
import type {
  TaskListResolver,
  WorkItemWriteResult,
  WorkItemWriter,
} from "../../runtime/task/TaskProtocol.js";
import {
  defineTool,
  type RegisteredTool,
  type ToolExecutionContext,
  type ToolResult,
} from "../../tooling/protocol/index.js";
import {
  defaultTaskResolver,
  resolveTaskList,
  taskToolFailure,
  workItemToJson,
} from "./TaskToolHelpers.js";

const TaskIdSchema = Type.String({
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
});

export const TaskUpdateParametersSchema = Type.Object(
  {
    taskId: TaskIdSchema,
    subject: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    description: Type.Optional(
      Type.String({ minLength: 0, maxLength: 4_000 }),
    ),
    activeForm: Type.Optional(
      Type.String({ minLength: 1, maxLength: 120 }),
    ),
    status: Type.Optional(
      Type.Union([
        Type.Literal("pending"),
        Type.Literal("in_progress"),
        Type.Literal("completed"),
        Type.Literal("deleted"),
      ]),
    ),
    owner: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    blocks: Type.Optional(
      Type.Array(TaskIdSchema, { maxItems: 32 }),
    ),
    addBlockedBy: Type.Optional(
      Type.Array(TaskIdSchema, { maxItems: 32 }),
    ),
    metadata: Type.Optional(
      Type.Record(
        Type.String({ minLength: 1, maxLength: 64 }),
        Type.Unknown(),
        { maxProperties: 16 },
      ),
    ),
  },
  { additionalProperties: false },
);

export interface TaskUpdateDetails extends JsonObject {
  readonly task: JsonObject;
  readonly revision: number;
}

export interface CreateWorkItemTaskUpdateToolOptions {
  readonly writer: WorkItemWriter;
  readonly resolver?: TaskListResolver;
  readonly logger?: Logger;
}

export function createWorkItemTaskUpdateTool(
  options: CreateWorkItemTaskUpdateToolOptions,
): RegisteredTool<typeof TaskUpdateParametersSchema, TaskUpdateDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "task_update_tool",
  });
  const resolver = options.resolver ?? defaultTaskResolver();
  return defineTool({
    descriptor: {
      name: "TaskUpdate",
      version: "1.0.0",
      label: "Task Update",
      description:
        "Updates one work item in the caller's task list: content, status, owner, dependencies, or metadata.",
      parameters: TaskUpdateParametersSchema,
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        const listId = await resolveTaskList(context, resolver);
        let result: WorkItemWriteResult;
        try {
          result = await options.writer.update({
            conversationId: context.conversationId,
            listId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            ...(context.turnId === undefined ? {} : { turnId: context.turnId }),
            taskId: arguments_.taskId,
            ...(arguments_.subject === undefined
              ? {}
              : { subject: arguments_.subject }),
            ...(arguments_.description === undefined
              ? {}
              : { description: arguments_.description }),
            ...(arguments_.activeForm === undefined
              ? {}
              : { activeForm: arguments_.activeForm }),
            ...(arguments_.status === undefined
              ? {}
              : { status: arguments_.status }),
            ...(arguments_.owner === undefined
              ? {}
              : { owner: arguments_.owner }),
            ...(arguments_.blocks === undefined
              ? {}
              : { blocks: arguments_.blocks }),
            ...(arguments_.addBlockedBy === undefined
              ? {}
              : { addBlockedBy: arguments_.addBlockedBy }),
            ...(arguments_.metadata === undefined
              ? {}
              : { metadata: arguments_.metadata }),
          });
        } catch (error) {
          if (error instanceof WorkItemNotFoundError) {
            throw taskToolFailure(
              context,
              "TASK_NOT_FOUND",
              false,
              "TaskUpdate",
              "1.0.0",
            );
          }
          if (error instanceof TypeError) {
            throw taskToolFailure(
              context,
              "TASK_UPDATE_INVALID_ARGUMENTS",
              false,
              "TaskUpdate",
              "1.0.0",
            );
          }
          throw taskToolFailure(
            context,
            "TASK_UPDATE_FAILED",
            true,
            "TaskUpdate",
            "1.0.0",
            "possible",
          );
        }
        context.signal.throwIfAborted();
        logger.info("runtime.task.tool_updated", {
          conversationId: context.conversationId,
          listId,
          runId: context.runId,
          toolCallId: context.toolCallId,
          taskId: result.task.id,
          revision: result.revision,
          eventSequence: result.eventSequence,
        });
        return Object.freeze({
          content: Object.freeze([
            Object.freeze({
              type: "text" as const,
              text: `Task ${result.task.id} updated.`,
            }),
          ]),
          details: Object.freeze({
            task: workItemToJson(result.task),
            revision: result.revision,
          }),
        });
      },
    },
  });
}
