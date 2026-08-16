# SnipTool

- **工具名**: `Snip`（userFacingName: `Snip`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/SnipTool/`
- **门槛**: `feature('HISTORY_SNIP')`（tools.ts 顶层条件加载，getAllBaseTools 中条件展开）
- **性质**: 非并发安全（`isConcurrencySafe() → false`）；非只读（`isReadOnly() → false`）；`strict: true`

## 描述（模型侧 desc）

`description()`（SnipTool.ts 内联）：

```
Snip messages from conversation history to free up context
```

模型侧 prompt（`prompt()`，SnipTool.ts 内联）：

```
Snip messages from your conversation history to free up context window space. Snipped messages are replaced with a compact summary so you retain awareness of what happened without the full content.

Use this when:
- Your context is getting full and you need to make room
- Earlier messages contain large tool outputs you no longer need in full
- You want to compact a long exploration sequence into a summary

Guidelines:
- Only snip messages you're confident you won't need verbatim again
- The summary replacement preserves key facts (file paths, decisions, errors found)
- You cannot un-snip — the original content is gone from context
```

## Input Schema

- `message_ids` (array(string), 必填): "IDs of the messages to snip from history. Snipped messages are replaced with a short summary."
- `reason` (string, 可选): "Why these messages are being snipped. Used in the summary replacement."
