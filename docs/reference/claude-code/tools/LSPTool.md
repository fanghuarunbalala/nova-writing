# LSPTool

- **工具名**: `LSP`（userFacingName: `LSP`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/LSPTool/`
- **门槛**: `isEnvTruthy(process.env.ENABLE_LSP_TOOL)`（`vendor/claude-code/src/tools.ts` getAllBaseTools 第 253 行）；另有 `isEnabled()` 运行时检查 `isLspConnected()`（有 LSP server 连接才可用）
- **性质**: 只读（`isReadOnly: true`）；并发安全（`isConcurrencySafe: true`）；`shouldDefer: true`；`isLsp: true`

## 描述（模型侧 desc）

`prompt.ts` 中 `DESCRIPTION` 常量，`description()` 与 `prompt()` 均返回它：

```
Interact with Language Server Protocol (LSP) servers to get code intelligence features.

Supported operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol
- hover: Get hover information (documentation, type info) for a symbol
- documentSymbol: Get all symbols (functions, classes, variables) in a document
- workspaceSymbol: Search for symbols across the entire workspace
- goToImplementation: Find implementations of an interface or abstract method
- prepareCallHierarchy: Get call hierarchy item at a position (functions/methods)
- incomingCalls: Find all functions/methods that call the function at a position
- outgoingCalls: Find all functions/methods called by the function at a position

All operations require:
- filePath: The file to operate on
- line: The line number (1-based, as shown in editors)
- character: The character offset (1-based, as shown in editors)

Note: LSP servers must be configured for the file type. If no server is available, an error will be returned.
```

## Input Schema

- `operation` (enum `goToDefinition` | `findReferences` | `hover` | `documentSymbol` | `workspaceSymbol` | `goToImplementation` | `prepareCallHierarchy` | `incomingCalls` | `outgoingCalls`, 必填): "The LSP operation to perform"
- `filePath` (string, 必填): "The absolute or relative path to the file"
- `line` (number, 必填): "The line number (1-based, as shown in editors)"
- `character` (number, 必填): "The character offset (1-based, as shown in editors)"
