# TaskStopTool

- **工具名**: `TaskStop`（userFacingName: `Stop Task`，`USER_TYPE === 'ant'` 时为空串）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/TaskStopTool/`
- **门槛**: 无条件（getAllBaseTools 直接列出）
- **性质**: 并发安全（isConcurrencySafe: true）
- **别名**: `KillShell`（废弃名，向后兼容）

## 描述（模型侧 desc）

来源：`TaskStopTool.ts` 内联 + `prompt.ts`。`description()` 返回：

```text
Stop a running background task by ID
```

`prompt()` 返回 `prompt.ts` 的 `DESCRIPTION` 常量：

```text

- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task

```

## Input Schema

- `task_id` (string, 可选): "The ID of the background task to stop"
- `shell_id` (string, 可选): "Deprecated: use task_id instead"
