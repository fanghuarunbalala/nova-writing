# ExitPlanModeTool

- **工具名**: `ExitPlanMode`（userFacingName: `''`（空字符串）；注册的是 V2 实现 `ExitPlanModeV2Tool`，wire name 不变）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/ExitPlanModeTool/`
- **门槛**: 无条件（`getAllBaseTools` 注册 `ExitPlanModeV2Tool`；`shouldDefer: true`；`isEnabled()` 在 `--channels` 激活（`KAIROS`/`KAIROS_CHANNELS` 且 `getAllowedChannels().length > 0`）时返回 `false`）
- **性质**: isReadOnly: `false`（源码注释 "Now writes to disk"）；isConcurrencySafe: `true`；requiresUserInteraction: 对 teammate 有条件豁免（team lead 经 mailbox 审批 / 自愿 plan mode 本地直接退出）
- **searchHint**: `'present plan for approval and start coding (plan mode only)'`
- **注**: `prompt.ts` 为 external stub（文件头注释 "External stub for ExitPlanModeTool prompt - excludes Ant-only allowedPrompts section"——Ant-only 的 allowedPrompts 提示段不在本快照中）。

## 描述（模型侧 desc）

`description()` 返回（内联）：

```
Prompts the user to exit plan mode and start coding
```

`prompt()` 返回 `EXIT_PLAN_MODE_V2_TOOL_PROMPT`（`${ASK_USER_QUESTION_TOOL_NAME}` 硬编码为 `AskUserQuestion`）：

```
Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of your plan file when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, use AskUserQuestion first (in earlier phases)
- Once your plan is finalized, use THIS tool to request approval

**Important:** Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.
```

## Input Schema

内部 schema（模型可见）：

- `allowedPrompts` (array, 可选): "Prompt-based permissions needed to implement the plan. These describe categories of actions rather than specific commands." 每项：
  - `tool` (enum `Bash`): "The tool this prompt applies to"
  - `prompt` (string): "Semantic description of the action, e.g. \"run tests\", \"install dependencies\""

另有 `.passthrough()` 允许额外字段通过。

SDK/内部面 schema（`_sdkInputSchema`，经 `normalizeToolInput` 注入的字段；plan 内容从磁盘读取，不由模型直接传参）：

- `plan` (string, 可选): "The plan content (injected by normalizeToolInput from disk)"
- `planFilePath` (string, 可选): "The plan file path (injected by normalizeToolInput)"
