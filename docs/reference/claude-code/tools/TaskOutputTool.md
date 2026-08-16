# TaskOutputTool

- **工具名**: `TaskOutput`（userFacingName: `Task Output`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/TaskOutputTool/`
- **门槛**: 无条件（getAllBaseTools 直接列出）；`isEnabled()`: `process.env.USER_TYPE !== 'ant'`
- **性质**: 只读（isReadOnly: true）、并发安全（isConcurrencySafe 委托 isReadOnly → true）
- **别名**: `AgentOutputTool`、`BashOutputTool`（向后兼容）

## 描述（模型侧 desc）

来源：`TaskOutputTool.tsx` 内联。`description()` 返回：

```text
[Deprecated] — prefer Read on the task output file path
```

`prompt()` 返回：

```text
DEPRECATED: Prefer using the Read tool on the task's output file path instead. Background tasks return their output file path in the tool result, and you receive a <task-notification> with the same path when the task completes — Read that file directly.

- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions
```

## Input Schema

- `task_id` (string, 必填): "The task ID to get output from"
- `block` (boolean, 可选, 默认 `true`, 语义布尔): "Whether to wait for completion"
- `timeout` (number, 可选, 默认 `30000`, min 0 / max 600000): "Max wait time in ms"
