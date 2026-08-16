# CronDeleteTool

- **工具名**: `CronDelete`（userFacingName: 未显式定义，buildTool 默认回退为 name，即 `CronDelete`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/ScheduleCronTool/`
- **门槛**: 无条件注册（tools.ts 顶层 `cronTools` 数组无条件 require，getAllBaseTools 直接展开）。运行时 `isEnabled() → isKairosCronEnabled()`（`CLAUDE_CODE_DISABLE_CRON` 未设为 truthy）
- **性质**: `shouldDefer: true`；isConcurrencySafe / isReadOnly 未定义（默认 false）

## 描述（模型侧 desc）

`description()` 返回常量 `CRON_DELETE_DESCRIPTION`（prompt.ts）：

```
Cancel a scheduled cron job by ID
```

模型侧 prompt（`prompt()` 返回 `buildCronDeletePrompt(isDurableCronEnabled())`，变量已替换：`CRON_CREATE_TOOL_NAME` = `CronCreate`）：

durable 开启：

```
Cancel a cron job previously scheduled with CronCreate. Removes it from .claude/scheduled_tasks.json (durable jobs) or the in-memory session store (session-only jobs).
```

durable 关闭：

```
Cancel a cron job previously scheduled with CronCreate. Removes it from the in-memory session store.
```

## Input Schema

- `id` (string, 必填): "Job ID returned by CronCreate."
