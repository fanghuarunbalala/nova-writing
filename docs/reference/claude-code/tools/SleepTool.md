# SleepTool

- **工具名**: `Sleep`（userFacingName: `Sleep`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/SleepTool/`
- **门槛**: `feature('PROACTIVE') || feature('KAIROS')`（tools.ts 顶层条件加载，getAllBaseTools 中条件展开）
- **性质**: 并发安全（`isConcurrencySafe() → true`）；只读（`isReadOnly() → true`）；`interruptBehavior() → 'cancel'`；`strict: true`

## 描述（模型侧 desc）

`description()` 返回常量 `DESCRIPTION`（prompt.ts）：

```
Wait for a specified duration
```

模型侧 prompt（`prompt()` 返回常量 `SLEEP_TOOL_PROMPT`，prompt.ts；`${TICK_TAG}` 已替换为 `<tick>`）：

```
Wait for a specified duration. The user can interrupt the sleep at any time.

Use this when the user tells you to sleep or rest, when you have nothing to do, or when you're waiting for something.

You may receive <tick> prompts — these are periodic check-ins. Look for useful work to do before sleeping.

You can call this concurrently with other tools — it won't interfere with them.

Prefer this over `Bash(sleep ...)` — it doesn't hold a shell process.

Each wake-up costs an API call, but the prompt cache expires after 5 minutes of inactivity — balance accordingly.
```

## Input Schema

- `duration_seconds` (number, 必填): "How long to sleep in seconds. Can be interrupted by the user at any time."
