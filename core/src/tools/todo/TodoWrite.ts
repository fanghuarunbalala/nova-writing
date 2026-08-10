/** Defines the complete-snapshot TodoWrite schema, descriptor, and handler. */
import { Type, type TObject } from "typebox";
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
          content: Type.String({
            minLength: 1,
            maxLength: TODO_LIMITS.maximumContentLength,
          }),
          status: Type.Union([
            Type.Literal("pending"),
            Type.Literal("in_progress"),
            Type.Literal("completed"),
          ]),
          activeForm: Type.String({
            minLength: 1,
            maxLength: TODO_LIMITS.maximumActiveFormLength,
          }),
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

export type TodoWriteItem = {
  readonly content: string;
  readonly status: TodoStatus;
  readonly activeForm: string;
};

export type TodoWriteDetails = {
  readonly oldTodos: TodoWriteItem[];
  readonly newTodos: TodoWriteItem[];
};

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
        "用一份完整 Todo 列表替换当前会话的执行计划，用于跟踪进度、组织多步任务、向用户展示推进情况。\n\n## 何时使用\n主动使用本工具：\n1. 复杂多步任务——需要 3 个及以上不同步骤或动作\n2. 非平凡/复杂任务——需要仔细规划或多个操作\n3. 用户明确要求维护任务列表\n4. 用户给了多个任务（编号或逗号分隔的清单）\n5. 接到新指令——立即把用户需求记录为 todo\n6. 开始做某任务前——先把它标为 in_progress（同一时间只保留一个）\n7. 完成某任务后——标为 completed，并把实施中发现的新任务补进来\n\n## 何时不用\n1. 只有单一、直接的任务\n2. 任务琐碎，记录没有组织价值\n3. 3 步以内即可完成\n4. 纯对话或信息性请求\n\n注意：只有一个琐碎任务时不要用，直接做更省事。\n\n## 使用示例\n\n<example>\n用户：帮我写「第三章·雨夜」，要完成章节大纲衔接、新角色登场、正文起草，最后还要自检一遍。\n助手：*创建 todo 列表：*\n1. 衔接第二、三章大纲\n2. 起草第三章正文\n3. 引入新角色「林深」\n4. 自检：伏笔与时间线一致性\n*开始第一项*\n\n<reasoning>\n用了 todo 是因为：多步创作任务需要逐项跟踪，且用户明确要求完成多个环节。\n</reasoning>\n</example>\n\n<example>\n用户：把主角在两章前留下的动机伏笔，在后三章里统一回收。\n助手：*先用读工具定位相关段落*，创建 todo：第五章回收动机、第六章推动矛盾、第七章揭晓，最后统一复查。\n<reasoning>\n跨多章改动是多步、非平凡任务，用 todo 逐章跟踪避免遗漏。\n</reasoning>\n</example>\n\n## 不使用示例\n\n<example>\n用户：主角叫什么名字？\n助手：直接回答主角的名字。\n<reasoning>\n纯信息性提问，单一直接，没有多步可跟踪。\n</reasoning>\n</example>\n\n<example>\n用户：把第一段里「他说」改成「他低声道」。\n助手：用 Edit 工具直接改这一处。\n<reasoning>\n单一、就地修改，无需任务列表。\n</reasoning>\n</example>\n\n## 任务状态与管理\n1. **状态**：pending（未开始）/ in_progress（进行中，同一时间只限一个）/ completed（完成）。\n   每个任务包含两种形式：\n   - content：祈使句，描述要做什么（如 \"完成第一章\"）\n   - activeForm：进行时，展示执行中状态（如 \"正在完成第一章\"）\n2. **管理**：实时更新状态；完成后**立即**标 completed（不要攒批）；任意时刻**恰好一个** in_progress；先完成当前任务再开新任务；不再相关的任务直接从列表中移除（本工具是整体替换，移除即不传入）。\n3. **完成条件**：**只有真正完成**才标 completed；遇到错误/阻塞/无法完成就保持 in_progress；被阻塞时新建一个描述待解决事项的任务；以下情况**绝不**标 completed：实现不完整、有未解决错误、缺少关键信息。\n4. **拆解**：建具体可执行条目；把复杂任务拆小；用清晰描述性命名；始终同时提供 content 与 activeForm 两种形式。\n\n拿不准就用。主动维护任务列表能确保所有需求都被完成。",
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
        const details = Object.freeze({
          oldTodos: [...(result.previousSnapshot?.todos ?? [])],
          newTodos: [...result.snapshot.todos],
        });
        logger.info("runtime.todo.tool_completed", {
          conversationId: context.conversationId,
          runId: context.runId,
          toolCallId: context.toolCallId,
          revision: result.snapshot.revision,
          total: result.snapshot.todos.length,
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

function todoWriteResult(details: TodoWriteDetails): ToolResult<TodoWriteDetails> {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: "Todo list updated." }),
    ]),
    details,
  });
}
