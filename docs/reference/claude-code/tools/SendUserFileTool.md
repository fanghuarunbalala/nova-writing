# SendUserFileTool

- **工具名**: `SendUserFile`（userFacingName: `SendFile`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/SendUserFileTool/`
- **门槛**: `feature('KAIROS')`（tools.ts 顶层条件加载，getAllBaseTools 中条件展开）。另有运行时 `isEnabled() → isBridgeEnabled()`
- **性质**: 并发安全（`isConcurrencySafe() → true`）；只读（`isReadOnly() → true`）；`strict: true`

## 描述（模型侧 desc）

`description()`（SendUserFileTool.ts 内联）：

```
Send a file to the user (KAIROS assistant mode)
```

模型侧 prompt（`prompt()`，SendUserFileTool.ts 内联）：

```
Send a file to the user's device. Use this in assistant mode when the user requests a file or when a file is relevant to the conversation.

Guidelines:
- Use absolute paths
- The file must exist and be readable
- Large files may take time to transfer
```

## Input Schema

- `file_path` (string, 必填): "Absolute path to the file to send to the user."
- `description` (string, 可选): "Optional description of the file being sent."
