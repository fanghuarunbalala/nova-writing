/**
 * TodoWrite 工具（从旧 main 分支迁移，CCB 对齐）。
 * 用完整 todo 列表替换当前会话执行计划。
 */
import type { ToolDef } from "../ToolDef.js";
import { todoWritePreview } from "../previews.js";
import type { ToolCall } from "../../provider/types.js";
import type { ConversationTodoStore, TodoItemSnapshot } from "../../todo/TodoProtocol.js";

/** 解析 tool args JSON */
function parseArgs(call: ToolCall): { todos: TodoItemSnapshot[] } {
  try {
    const args = JSON.parse(call.args) as { todos: TodoItemSnapshot[] };
    return args;
  } catch {
    throw new Error(`无效的 JSON 参数: ${call.args}`);
  }
}

/** TodoWrite 描述（CCB 对齐：何时用 / 何时不用 / 任务状态与管理） */
const TODO_WRITE_DESCRIPTION = [
  "用一份完整 Todo 列表替换当前会话的执行计划，用于跟踪进度、组织多步任务、向用户展示推进情况。",
  "",
  "## 何时使用",
  "主动使用本工具：",
  "1. 复杂多步任务——需要 3 个及以上不同步骤或动作",
  "2. 非平凡/复杂任务——需要仔细规划或多个操作",
  "3. 用户明确要求维护任务列表",
  "4. 用户给了多个任务（编号或逗号分隔的清单）",
  "5. 接到新指令——立即把用户需求记录为 todo",
  "6. 开始做某任务前——先把它标为 in_progress（同一时间只保留一个）",
  "7. 完成某任务后——标为 completed，并把实施中发现的新任务补进来",
  "",
  "## 何时不用",
  "1. 只有单一、直接的任务",
  "2. 任务琐碎，记录没有组织价值",
  "3. 3 步以内即可完成",
  "4. 纯对话或信息性请求",
  "",
  "## 任务状态与管理",
  "1. **状态**：pending（未开始）/ in_progress（进行中，同一时间只限一个）/ completed（完成）。",
  "   每个任务包含两种形式：",
  "   - content：祈使句，描述要做什么（如 \"完成第一章\"）",
  "   - activeForm：进行时，展示执行中状态（如 \"正在完成第一章\"）",
  "2. **管理**：实时更新状态；完成后**立即**标 completed；任意时刻**恰好一个** in_progress；不再相关的任务直接从列表中移除（本工具是整体替换）。",
  "3. **完成条件**：**只有真正完成**才标 completed；遇到错误/阻塞/无法完成就保持 in_progress；以下情况**绝不**标 completed：实现不完整、有未解决错误、缺少关键信息。",
  "4. **拆解**：建具体可执行条目；把复杂任务拆小；始终同时提供 content 与 activeForm 两种形式。",
  "",
  "拿不准就用。主动维护任务列表能确保所有需求都被完成。",
].join("\n");

/**
 * 创建 TodoWrite 工具（handler 闭包 todo store + conversationId）
 * @param todoStore 会话 todo 存储
 * @param conversationId 会话 id
 * @returns TodoWrite 工具定义
 */
export function createTodoWriteTool(todoStore: ConversationTodoStore, conversationId: string): ToolDef {
  return {
    name: "TodoWrite",
    version: "1.0.0",
    preview: todoWritePreview,
    description: TODO_WRITE_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "completed"] },
              activeForm: { type: "string" },
            },
            required: ["content", "status", "activeForm"],
            additionalProperties: false,
          },
        },
      },
      required: ["todos"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "Use TodoWrite to track progress on non-trivial multi-step work.",
      guidance: "Replace the whole todo list; exactly one in_progress; provide content + activeForm for each item.",
    },
    handler: {
      execute: async (call) => {
        const { todos } = parseArgs(call);
        const prev = await todoStore.read(conversationId);
        const snapshot = {
          conversationId,
          revision: (prev?.revision ?? 0) + 1,
          todos,
          updatedAt: new Date().toISOString(),
        };
        await todoStore.save(snapshot);
        return JSON.stringify(snapshot.todos, null, 2);
      },
    },
  };
}
