# SearchExtraToolsTool

- **工具名**: `SearchExtraTools`（userFacingName: `SearchExtraTools`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/SearchExtraToolsTool/`
- **门槛**: `isSearchExtraToolsEnabledOptimistic()`（tools.ts getAllBaseTools 中条件展开；注释说明为乐观检查，是否真正 defer 工具在请求时由 claude.ts 决定）。该函数基于 `getSearchExtraToolsMode()`（由 `ENABLE_SEARCH_EXTRA_TOOLS` 环境变量控制：unset/`true`/`auto:0` → `tst`；`auto`/`auto:1-99` → `tst-auto`；`false`/`auto:100` → `standard`；`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` truthy 强制 `standard`），mode 为 `standard` 时返回 false
- **性质**: 并发安全（`isConcurrencySafe() → true`）；只读（`isReadOnly() → true`）

## 描述（模型侧 desc）

`description()` 与 `prompt()` 均返回 `getPrompt()`，即 `PROMPT_HEAD + getToolLocationHint() + PROMPT_TAIL`（prompt.ts）。拼装后的最终文本如下，中间一句 location hint 有两版：delta 开启（`USER_TYPE === 'ant'` 或 GrowthBook `tengu_glacier_2xr`）时工具名出现在 `<system-reminder>`，否则出现在 `<available-deferred-tools>`：

```
Search for deferred tools by name or keyword. LOW PRIORITY — only use this tool when no core tool can accomplish the task. Core tools (Read, Edit, Write, Bash, Glob, Grep, Agent, WebFetch, WebSearch, Skill) are always available and should be used directly. This tool is for discovering additional capabilities like MCP tools, cron scheduling, worktree management, agent teams (TeamCreate, TeamDelete, SendMessage), etc.

Deferred tools appear by name in <system-reminder> messages. Returns matching tool names.

## Two-step workflow (MUST follow exactly)

Deferred tools CANNOT be called directly. You MUST use this two-step pattern:

Step 1 — Search: Call this tool (SearchExtraTools) to discover the target tool.
  Input: {"query": "select:CronCreate"}
  Response: "Found 1 deferred tool(s): CronCreate. Use ExecuteExtraTool with {"tool_name": "<name>", "params": {...}} to invoke."

Step 2 — Execute: Call ExecuteExtraTool to run the discovered tool.
  Input: {"tool_name": "CronCreate", "params": {"schedule": "*/5 * * * *", "prompt": "check the deploy"}}
  Response: the actual tool result.

## Example: user asks "schedule a cron to check deploy every 5 minutes"

1. SearchExtraTools({"query": "select:CronCreate"})
   → Response: Found deferred tool CronCreate
2. ExecuteExtraTool({"tool_name": "CronCreate", "params": {"schedule": "*/5 * * * *", "prompt": "check the deploy"}})
   → Response: Cron job created successfully

If you don't know the exact tool name, use keyword search first:
1. SearchExtraTools({"query": "cron schedule"})
   → Response: Found deferred tool(s): CronCreate
2. ExecuteExtraTool({"tool_name": "CronCreate", "params": {...}})

## Query forms
- "select:CronCreate" — exact tool name (fastest, preferred when you know the name from <available-deferred-tools>)
- "select:CronCreate,CronList" — comma-separated multi-select
- "discover:schedule cron job" — returns tool name + description + schema without loading. Use to understand a tool before calling it.
- "notebook jupyter" — keyword search, up to max_results best matches
- "+slack send" — require "slack" in the name, rank by remaining terms

## Failure policy
If ExecuteExtraTool fails, do NOT re-search for the same tool — it will loop. Stop and tell the user what failed.
```

（delta 关闭时第 3 段为 `Deferred tools appear by name in <available-deferred-tools> messages. Returns matching tool names.`，其余相同。）

## Input Schema

- `query` (string, 必填): "Query to find deferred tools. Use \"select:<tool_name>\" for direct selection, or keywords to search."
- `max_results` (number, 可选, 默认 5): "Maximum number of results to return (default: 5)"
