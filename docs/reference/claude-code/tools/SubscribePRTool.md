# SubscribePRTool

- **工具名**: `SubscribePR`（userFacingName: `SubscribePR`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/SubscribePRTool/`
- **门槛**: `feature('KAIROS_GITHUB_WEBHOOKS')`（tools.ts 顶层条件加载，getAllBaseTools 中条件展开）
- **性质**: 并发安全（`isConcurrencySafe() → true`）；只读（`isReadOnly() → true`）；`strict: true`

## 描述（模型侧 desc）

`description()`（SubscribePRTool.ts 内联）：

```
Subscribe to pull request events via GitHub webhooks
```

模型侧 prompt（`prompt()`，SubscribePRTool.ts 内联）：

```
Subscribe to events on a GitHub pull request. You'll receive notifications when selected events occur (comments, reviews, CI status changes, merge, close).

Use this to monitor PRs you've created or are reviewing. Events are delivered as messages you can act on.
```

## Input Schema

- `repo` (string, 必填): "Repository in owner/repo format."
- `pr_number` (number, 必填): "Pull request number to subscribe to."
- `events` (array(enum: `'comment' | 'review' | 'ci' | 'merge' | 'close'`), 可选): "Event types to subscribe to. Defaults to all events."
