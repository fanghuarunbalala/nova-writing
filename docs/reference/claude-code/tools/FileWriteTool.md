# FileWriteTool

- **工具名**: `Write`（userFacingName: 动态——默认 `Write`；plan 目录文件 `Updated plan`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/FileWriteTool/`
- **门槛**: 无条件
- **性质**: `strict: true`
- **searchHint**: `'create or overwrite files'`

## 描述（模型侧 desc）

`description()` 返回（内联）：

```
Write a file to the local filesystem.
```

`prompt()` 返回 `getWriteToolDescription()`（`${FILE_READ_TOOL_NAME}` 已替换为 `Read`）：

```
Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.
- The file_path must be a distinct file path, not a directory path. If the path resolves to an existing directory, the tool will reject it with a clear error message. Use a path that includes a filename with an appropriate extension (e.g., `my-docs/analysis/api/report.md`).
```

## Input Schema

- `file_path` (string, 必填): "The absolute path to the file to write (must be absolute, not relative)"
- `content` (string, 必填): "The content to write to the file"
