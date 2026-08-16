# SuggestBackgroundPRTool

- **工具名**: `SuggestBackgroundPR`（userFacingName: `SuggestPR`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/SuggestBackgroundPRTool/`
- **门槛**: `process.env.USER_TYPE === 'ant'`（tools.ts 顶层条件加载，getAllBaseTools 中条件展开）
- **性质**: 并发安全（`isConcurrencySafe() → true`）；只读（`isReadOnly() → true`）；`strict: true`

## 描述（模型侧 desc）

`description()`（SuggestBackgroundPRTool.ts 内联）：

```
Suggest creating a background PR for follow-up changes
```

模型侧 prompt（`prompt()`，SuggestBackgroundPRTool.ts 内联）：

```
Suggest creating a pull request in the background for follow-up work. Use this when you identify improvements or cleanup that should be done but aren't part of the current task.

The suggestion is presented to the user who can approve or dismiss it. If approved, a background agent creates the PR.
```

## Input Schema

- `title` (string, 必填): "Suggested title for the background PR."
- `description` (string, 必填): "Description of the changes to make in the background PR."
- `branch` (string, 可选): "Branch name for the PR. Auto-generated if omitted."
