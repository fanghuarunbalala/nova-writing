# GoalTool

- **工具名**: `GoalTool`（userFacingName: `Goal`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/GoalTool/`
- **门槛**: `feature('GOAL')`（`vendor/claude-code/src/tools.ts` getAllBaseTools 中 `...(GoalTool ? [GoalTool] : [])`）
- **性质**: 并发安全（`isConcurrencySafe: true`）；只读取决于输入（`isReadOnly(input)`：action 为 "get" 时只读，为 "update" 时非只读）；`shouldDefer: true`

## 描述（模型侧 desc）

`prompt.ts` 中 `DESCRIPTION` 常量，`description()` 返回它：

```
Get or update the active goal status. The model may only mark a goal as "complete" or "blocked".
```

`prompt()` 返回 `generatePrompt()` 拼装文本：

```
Use this tool to interact with the active thread goal.

## Actions

### get
Returns the current goal state (objective, status, token usage, elapsed time, turns executed).
No input required beyond `action: "get"`.

### update
Transition the goal to a terminal status. Only two values are accepted:
- **complete** — All requirements are verified (see Completion Audit below).
- **blocked** — An insurmountable obstacle has persisted for 3+ consecutive turns (see Blocked Audit below).

When marking complete, provide a brief `reason` summarising what was achieved.
When marking blocked, provide a `reason` describing the specific blocker.

## Completion Audit (required before marking complete)
1. Derive concrete requirements from the objective.
2. Preserve the original scope — do not redefine success around existing work.
3. For every requirement, identify authoritative evidence (test output, file content, command result).
4. Treat tests and manifests as evidence only after confirming they cover the requirement.
5. Treat uncertain or indirect evidence as "not achieved".
6. The audit must PROVE completion, not merely fail to find remaining work.

## Blocked Audit (required before marking blocked)
1. The same blocking condition must persist across at least 3 consecutive continuation turns.
2. "Difficult", "slow", or "partially incomplete" is NOT blocked.
3. Only genuinely insurmountable obstacles qualify (missing credentials, external service down, etc.).

## Important
- You cannot pause, resume, or clear a goal — only the user can do that via `/goal`.
- If no goal is active, `get` returns a message saying so; `update` returns an error.
- On completion, the tool result includes a usage report (tokens, time, turns).
```

## Input Schema

- `action` (enum `get` | `update`, 可选): "Action to perform: \"get\" to read status, \"update\" to mark complete or blocked. Defaults to \"update\" if status is provided, otherwise \"get\"."
- `status` (enum `complete` | `blocked`, 可选): "Required for \"update\". Only \"complete\" or \"blocked\" are accepted."
- `reason` (string, 可选): "Explanation for the status change. Required for \"update\"."
