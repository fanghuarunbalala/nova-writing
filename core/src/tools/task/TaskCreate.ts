/** Defines the TaskCreate schema, descriptor, and handler. */
import { Type } from "typebox";
import type { JsonObject } from "../../event/protocol/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  type TaskListResolver,
  type WorkItemWriteResult,
  type WorkItemWriter,
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
} from "./TaskToolHelpers.js";

export const TaskCreateParametersSchema = Type.Object(
  {
    subject: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.String({ minLength: 0, maxLength: 4_000 }),
    activeForm: Type.Optional(
      Type.String({ minLength: 1, maxLength: 120 }),
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

export interface TaskCreateDetails extends JsonObject {
  readonly taskId: string;
  readonly status: string;
  readonly listId: string;
  readonly revision: number;
}

export interface CreateWorkItemTaskCreateToolOptions {
  readonly writer: WorkItemWriter;
  readonly resolver?: TaskListResolver;
  readonly logger?: Logger;
}

export function createWorkItemTaskCreateTool(
  options: CreateWorkItemTaskCreateToolOptions,
): RegisteredTool<typeof TaskCreateParametersSchema, TaskCreateDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "task_create_tool",
  });
  const resolver = options.resolver ?? defaultTaskResolver();
  return defineTool({
    descriptor: {
      name: "TaskCreate",
      version: "1.0.0",
      label: "Task Create",
      description:
        "Creates a pending work item in the caller's task list. Never executes work.",
      parameters: TaskCreateParametersSchema,
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        const listId = await resolveTaskList(context, resolver);
        let result: WorkItemWriteResult;
        try {
          result = await options.writer.create({
            conversationId: context.conversationId,
            listId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            ...(context.turnId === undefined ? {} : { turnId: context.turnId }),
            subject: arguments_.subject,
            description: arguments_.description,
            ...(arguments_.activeForm === undefined
              ? {}
              : { activeForm: arguments_.activeForm }),
            ...(arguments_.metadata === undefined
              ? {}
              : { metadata: arguments_.metadata }),
          });
        } catch (error) {
          if (error instanceof TypeError) {
            throw taskToolFailure(
              context,
              "TASK_CREATE_INVALID_ARGUMENTS",
              false,
              "TaskCreate",
              "1.0.0",
            );
          }
          throw taskToolFailure(
            context,
            "TASK_CREATE_FAILED",
            true,
            "TaskCreate",
            "1.0.0",
            "possible",
          );
        }
        context.signal.throwIfAborted();
        logger.info("runtime.task.tool_created", {
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
              text: `Task ${result.task.id} created.`,
            }),
          ]),
          details: Object.freeze({
            taskId: result.task.id,
            status: result.task.status,
            listId: result.listId,
            revision: result.revision,
          }),
        });
      },
    },
  });
}
