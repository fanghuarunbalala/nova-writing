# TaskGetTool

- **工具名**: `TaskGet`（userFacingName: `TaskGet`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/TaskGetTool/`
- **门槛**: `isTodoV2Enabled()`（getAllBaseTools 中 `isTodoV2Enabled() ? [TaskCreateTool, TaskGetTool, TaskUpdateTool, TaskListTool] : []` 条件展开）；`isEnabled() → isTodoV2Enabled()`
- **性质**: 并发安全（`isConcurrencySafe() → true`）；只读（`isReadOnly() → true`）；`shouldDefer: true`

## 描述（模型侧 desc）

`description()` 返回常量 `DESCRIPTION`（prompt.ts）：

```
Get a task by ID from the task list
```

模型侧 prompt（`prompt()` 返回常量 `PROMPT`，prompt.ts）：

```
Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.
```

## Input Schema

- `taskId` (string, 必填): "The ID of the task to retrieve"
