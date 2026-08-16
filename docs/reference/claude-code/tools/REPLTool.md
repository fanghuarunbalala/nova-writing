# REPLTool

- **工具名**: `REPL`（userFacingName: `REPL`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/REPLTool/`
- **门槛**: `process.env.USER_TYPE === 'ant'`（tools.ts 顶层 `const REPLTool = process.env.USER_TYPE === 'ant' ? require(...).REPLTool : null`，getAllBaseTools 中 `process.env.USER_TYPE === 'ant' && REPLTool ? [REPLTool] : []`）。REPL 模式本身另由 `isReplModeEnabled()` 决定（constants.ts：`CLAUDE_CODE_REPL` 未设为 falsy、或 `CLAUDE_REPL_MODE` truthy、或 `USER_TYPE === 'ant'` 且 entrypoint 为 cli）
- **性质**: 非并发安全（`isConcurrencySafe() → false`）；非只读（`isReadOnly() → false`）；`isTransparentWrapper() → true`；`strict: true`

## 描述（模型侧 desc）

`description()`（REPLTool.ts 内联）：

```
Execute code in the REPL environment with access to all primitive tools
```

模型侧 prompt（`prompt()`，REPLTool.ts 内联）：

```
Execute code in the REPL — a sandboxed environment with direct access to primitive tools (Read, Write, Edit, Glob, Grep, Bash, NotebookEdit, Agent).

When REPL mode is active, primitive tools are only accessible through this tool. Use REPL for:
- Batch operations across many files
- Complex multi-step file transformations
- Operations that benefit from programmatic control flow
- Combining search results with edits in a single turn

The REPL runs in a VM context with tool APIs available as functions. Results from each tool call are collected and returned together.
```

## Input Schema

- `code` (string, 必填): "The code to execute in the REPL. Can call any primitive tool (Read, Write, Edit, Glob, Grep, Bash, NotebookEdit, Agent) via their APIs."

## 附加模型侧内容（如有）

REPL 模式下被隐藏为仅可经 REPL 访问的原始工具集（constants.ts `REPL_ONLY_TOOLS`，模型不可直接调用）：`Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`NotebookEdit`、`Agent`。
