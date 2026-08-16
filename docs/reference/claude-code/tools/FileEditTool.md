# FileEditTool

- **工具名**: `Edit`（userFacingName: 动态——默认 `Update`；`old_string === ''` 时 `Create`；plan 目录文件 `Updated plan`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/FileEditTool/`
- **门槛**: 无条件
- **性质**: `strict: true`
- **searchHint**: `'modify file contents in place'`

## 描述（模型侧 desc）

`description()` 返回（内联）：`A tool for editing files`。
`prompt()` 返回 `getEditToolDescription()`。变量已替换：`${FILE_READ_TOOL_NAME}` = `Read`；
行号前缀格式由 `isCompactLinePrefixEnabled()` 决定（默认 `tengu_compact_line_prefix_killswitch` 关闭 → compact 开启 → `line number + tab`，反之为 `spaces + line number + arrow`）。按默认基线（compact 前缀、非 ant）拼装：

```
Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. 
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + tab. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.
- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.
- The file_path must be a file path, not a directory path. If the path resolves to an existing directory, the tool will reject it. Use a path that points to an existing file.
```

**条件差异**：ant 用户（`process.env.USER_TYPE === 'ant'`）时，`replace_all` 提示句前追加一条：

```
- Use the smallest old_string that's clearly unique — usually 2-4 adjacent lines is sufficient. Avoid including 10+ lines of context when less uniquely identifies the target.
```

非 compact 前缀（killswitch 开启）时，前缀描述替换为 `spaces + line number + arrow`。

## Input Schema

- `file_path` (string, 必填): "The absolute path to the file to modify"
- `old_string` (string, 必填): "The text to replace"
- `new_string` (string, 必填): "The text to replace it with (must be different from old_string)"
- `replace_all` (boolean, 默认 `false`, 经 `semanticBoolean` 预处理): "Replace all occurrences of old_string (default false)"
