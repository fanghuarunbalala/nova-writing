# TaskCreateTool

- **工具名**: `TaskCreate`（userFacingName: `TaskCreate`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/TaskCreateTool/`
- **门槛**: `isTodoV2Enabled()`（getAllBaseTools 中 `isTodoV2Enabled() ? [TaskCreateTool, TaskGetTool, TaskUpdateTool, TaskListTool] : []` 条件展开）；`isEnabled() → isTodoV2Enabled()`
- **性质**: 并发安全（`isConcurrencySafe() → true`）；isReadOnly 未定义（默认 false）；`shouldDefer: true`

## 描述（模型侧 desc）

`description()` 返回常量 `DESCRIPTION`（prompt.ts）：

```
Create a new task in the task list
```

模型侧 prompt（`prompt()` 返回 `getPrompt()`，prompt.ts，按 `isAgentSwarmsEnabled()` 构建时开关拼接两处；以下为拼装后的最终文本，swarms 开启版包含「and potentially assigned to teammates」与 teammate tips 两条）：

```
Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations and potentially assigned to teammates
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks
- When you start working on a task - Mark it as in_progress BEFORE beginning work
- After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking it provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task Fields

- **subject**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: What needs to be done
- **activeForm** (optional): Present continuous form shown in the spinner when the task is in_progress (e.g., "Fixing authentication bug"). If omitted, the spinner shows the subject instead.

All tasks are created with status `pending`.

## Tips

- Create tasks with clear, specific subjects that describe the outcome
- After creating tasks, use TaskUpdate to set up dependencies (blocks/blockedBy) if needed
- Include enough detail in the description for another agent to understand and complete the task
- New tasks are created with status 'pending' and no owner - use TaskUpdate with the `owner` parameter to assign them
- Check TaskList first to avoid creating duplicate tasks
```

（swarms 关闭时省略「and potentially assigned to teammates」与「- Include enough detail …」/「- New tasks are created …」两条 tips。）

## Input Schema

- `subject` (string, 必填): "A brief title for the task"
- `description` (string, 必填): "What needs to be done"
- `activeForm` (string, 可选): "Present continuous form shown in spinner when in_progress (e.g., \"Running tests\")"
- `metadata` (record(string, unknown), 可选): "Arbitrary metadata to attach to the task"
