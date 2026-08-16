# CronListTool

- **工具名**: `CronList`（userFacingName: 未显式定义，buildTool 默认回退为 name，即 `CronList`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/ScheduleCronTool/`
- **门槛**: 无条件注册（tools.ts 顶层 `cronTools` 数组无条件 require，getAllBaseTools 直接展开）。运行时 `isEnabled() → isKairosCronEnabled()`（`CLAUDE_CODE_DISABLE_CRON` 未设为 truthy）
- **性质**: 并发安全（`isConcurrencySafe() → true`）；只读（`isReadOnly() → true`）；`shouldDefer: true`

## 描述（模型侧 desc）

`description()` 返回常量 `CRON_LIST_DESCRIPTION`（prompt.ts）：

```
List scheduled cron jobs
```

模型侧 prompt（`prompt()` 返回 `buildCronListPrompt(isDurableCronEnabled())`，变量已替换：`CRON_CREATE_TOOL_NAME` = `CronCreate`）：

durable 开启：

```
List all cron jobs scheduled via CronCreate, both durable (.claude/scheduled_tasks.json) and session-only.
```

durable 关闭：

```
List all cron jobs scheduled via CronCreate in this session.
```

## Input Schema

无输入字段（`z.strictObject({})`，空 schema）。
