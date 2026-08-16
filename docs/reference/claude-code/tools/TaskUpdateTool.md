# TaskUpdateTool

- **工具名**: `TaskUpdate`（userFacingName: `TaskUpdate`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/TaskUpdateTool/`
- **门槛**: `isTodoV2Enabled()`（`src/utils/tasks.js`：`CLAUDE_CODE_ENABLE_TASKS` 环境变量为真，或当前为非交互会话时启用）
- **性质**: 并发安全（isConcurrencySafe: true）

## 描述（模型侧 desc）

来源：`prompt.ts`。`description()` 返回 `DESCRIPTION` 常量：

```text
Update a task in the task list
```

`prompt()` 返回 `PROMPT` 常量：

````text
Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them
- After resolving, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to `deleted` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: `pending` → `in_progress` → `completed`

Use `deleted` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using `TaskGet` before updating it.

## Examples

Mark task as in progress when starting work:
```json
{"taskId": "1", "status": "in_progress"}
```

Mark task as completed after finishing work:
```json
{"taskId": "1", "status": "completed"}
```

Delete a task:
```json
{"taskId": "1", "status": "deleted"}
```

Claim a task by setting owner:
```json
{"taskId": "1", "owner": "my-name"}
```

Set up task dependencies:
```json
{"taskId": "2", "addBlockedBy": ["1"]}
```
````

## Input Schema

- `taskId` (string, 必填): "The ID of the task to update"
- `subject` (string, 可选): "New subject for the task"
- `description` (string, 可选): "New description for the task"
- `activeForm` (string, 可选): "Present continuous form shown in spinner when in_progress (e.g., \"Running tests\")"
- `status` (enum `pending` | `in_progress` | `completed` | `deleted`, 可选): "New status for the task"
- `addBlocks` (array<string>, 可选): "Task IDs that this task blocks"
- `addBlockedBy` (array<string>, 可选): "Task IDs that block this task"
- `owner` (string, 可选): "New owner for the task"
- `metadata` (record<string, unknown>, 可选): "Metadata keys to merge into the task. Set a key to null to delete it."
