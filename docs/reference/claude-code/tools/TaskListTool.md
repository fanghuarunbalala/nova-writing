# TaskListTool

- **工具名**: `TaskList`（userFacingName: `TaskList`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/TaskListTool/`
- **门槛**: `isTodoV2Enabled()`（`src/utils/tasks.js`：`CLAUDE_CODE_ENABLE_TASKS` 环境变量为真，或当前为非交互会话时启用）
- **性质**: 只读（isReadOnly: true）、并发安全（isConcurrencySafe: true）

## 描述（模型侧 desc）

来源：`prompt.ts`。`description()` 返回 `DESCRIPTION` 常量；`prompt()` 返回 `getPrompt()` 拼装文本（`isAgentSwarmsEnabled()` 为 true 时的最终拼装结果，本 fork 构建默认启用 agent teams）。

```text
List all tasks in the task list
```

```text
Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- Before assigning tasks to teammates, to see what's available
- After completing a task, to check for newly unblocked work or claim the next available task
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones

## Output

Returns a summary of each task:
- **id**: Task identifier (use with TaskGet, TaskUpdate)
- **subject**: Brief description of the task
- **status**: 'pending', 'in_progress', or 'completed'
- **owner**: Agent ID if assigned, empty if available
- **blockedBy**: List of open task IDs that must be resolved first (tasks with blockedBy cannot be claimed until dependencies resolve)

Use TaskGet with a specific task ID to view full details including description and comments.

## Teammate Workflow

When working as a teammate:
1. After completing your current task, call TaskList to find available work
2. Look for tasks with status 'pending', no owner, and empty blockedBy
3. **Prefer tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones
4. Claim an available task using TaskUpdate (set `owner` to your name), or wait for leader assignment
5. If blocked, focus on unblocking tasks or notify the team lead
```

## Input Schema

`z.strictObject({})` — 无输入字段。
