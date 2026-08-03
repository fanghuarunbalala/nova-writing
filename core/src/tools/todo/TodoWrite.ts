/** Defines the complete-snapshot TodoWrite schema, descriptor, and handler. */
import { Type, type TObject } from "typebox";
import type { JsonObject } from "../../event/protocol/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import { ToolError } from "../../runtime/tools/execution/index.js";
import {
  TODO_LIMITS,
  type ConversationTodoWriter,
  type TodoStatus,
} from "../../runtime/todo/index.js";
import { captureTodoItems } from "../../runtime/todo/TodoProtocolValidator.js";
import {
  defineTool,
  type RegisteredTool,
  type ToolExecutionContext,
  type ToolResult,
} from "../../tooling/protocol/index.js";

export const TodoWriteParametersSchema = Type.Object(
  {
    todos: Type.Array(
      Type.Object(
        {
          id: Type.String({
            pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          }),
          content: Type.String({ minLength: 1, maxLength: TODO_LIMITS.maximumContentLength }),
          status: Type.Union([
            Type.Literal("pending"),
            Type.Literal("in_progress"),
            Type.Literal("completed"),
            Type.Literal("cancelled"),
          ]),
        },
        { additionalProperties: false },
      ),
      { maxItems: TODO_LIMITS.maximumItems },
    ),
  },
  { additionalProperties: false },
);

export interface TodoWriteArguments {
  readonly todos: readonly TodoWriteItem[];
}

export interface TodoWriteItem {
  readonly id: string;
  readonly content: string;
  readonly status: TodoStatus;
}

export interface TodoWriteDetails extends JsonObject {
  readonly revision: number;
  readonly total: number;
  readonly pending: number;
  readonly inProgress: number;
  readonly completed: number;
  readonly cancelled: number;
}

export interface CreateTodoWriteToolOptions {
  readonly writer: ConversationTodoWriter;
  readonly logger?: Logger;
}

export function createTodoWriteTool(
  options: CreateTodoWriteToolOptions,
): RegisteredTool<typeof TodoWriteParametersSchema, TodoWriteDetails> {
  const logger = (options.logger ?? noopLogger).child({
    component: "todo_write_tool",
  });

  return defineTool({
    descriptor: {
      name: "TodoWrite",
      version: "1.0.0",
      label: "Todo Write",
      description:
        "Replaces the current Conversation execution plan with a complete Todo snapshot. Use stable IDs, keep one active step, and mark finished work completed.",
      parameters: TodoWriteParametersSchema,
    },
    handler: {
      async execute(context, arguments_) {
        context.signal.throwIfAborted();
        const captured = captureTodoWriteArguments(arguments_);
        let result;
        try {
          result = await options.writer.replace({
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            ...(context.turnId === undefined ? {} : { turnId: context.turnId }),
            todos: captured.todos,
          });
        } catch {
          throw new ToolError({
            code: "TODO_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId: context.conversationId,
            runId: context.runId,
            toolCallId: context.toolCallId,
            toolName: "TodoWrite",
            toolVersion: "1.0.0",
          });
        }
        context.signal.throwIfAborted();
        const details = summarize(result.snapshot.todos, result.snapshot.revision);
        logger.info("runtime.todo.tool_completed", {
          conversationId: context.conversationId,
          runId: context.runId,
          toolCallId: context.toolCallId,
          revision: details.revision,
          total: details.total,
          eventSequence: result.eventSequence,
        });
        return todoWriteResult(details);
      },
    },
  });
}

function captureTodoWriteArguments(value: unknown): TodoWriteArguments {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("todos" in value)
  ) {
    throw new ToolError({
      code: "TODO_WRITE_INVALID_ARGUMENTS",
      category: "validation",
      retryable: false,
      sideEffectStatus: "none",
      toolName: "TodoWrite",
      toolVersion: "1.0.0",
    });
  }
  try {
    return Object.freeze({ todos: captureTodoItems(value.todos) });
  } catch {
    throw new ToolError({
      code: "TODO_WRITE_INVALID_ARGUMENTS",
      category: "validation",
      retryable: false,
      sideEffectStatus: "none",
      toolName: "TodoWrite",
      toolVersion: "1.0.0",
    });
  }
}

function summarize(
  todos: readonly TodoWriteItem[],
  revision: number,
): TodoWriteDetails {
  return Object.freeze({
    revision,
    total: todos.length,
    pending: todos.filter((todo) => todo.status === "pending").length,
    inProgress: todos.filter((todo) => todo.status === "in_progress").length,
    completed: todos.filter((todo) => todo.status === "completed").length,
    cancelled: todos.filter((todo) => todo.status === "cancelled").length,
  });
}

function todoWriteResult(details: TodoWriteDetails): ToolResult<TodoWriteDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: "Todo list updated." }),
    ]),
    details,
  });
}
