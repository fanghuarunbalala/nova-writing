# CtxInspectTool

- **工具名**: `CtxInspect`（userFacingName: `CtxInspect`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/CtxInspectTool/`
- **门槛**: `feature('CONTEXT_COLLAPSE')`（tools.ts 中 `CtxInspectTool ? [CtxInspectTool] : []`，import 仅在 GrowthBook feature `CONTEXT_COLLAPSE` 开启时解析）
- **性质**: isReadOnly: `true`；isConcurrencySafe: `true`；`strict: true`
- **searchHint**: `'context inspect tokens usage messages window collapse'`
- **注**: 本工具无独立 `prompt.ts`，desc 与 prompt 均内联在 `CtxInspectTool.ts`。

## 描述（模型侧 desc）

`description()` 返回：

```
Inspect the current context window contents and token usage
```

`prompt()` 返回（内联）：

```
Inspect the current conversation context. Shows token usage, message count, and a breakdown of what's consuming context space.

Use this to understand your context budget before deciding whether to snip old messages or adjust your approach.
```

## Input Schema

- `query` (string, 可选): "Optional query to filter context entries. If omitted, returns a summary of all context."
