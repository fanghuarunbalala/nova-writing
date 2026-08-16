# GrepTool

- **工具名**: `Grep`（userFacingName: `Search`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/GrepTool/`
- **门槛**: 仅当 `hasEmbeddedSearchTools()` 为 false 时注册（ant 原生构建内嵌 bfs/ugrep 时不注册，见 `vendor/claude-code/src/tools.ts` getAllBaseTools：`...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool])`）
- **性质**: 只读（`isReadOnly: true`）；并发安全（`isConcurrencySafe: true`）；`strict: true`

## 描述（模型侧 desc）

`prompt.ts` 中 `getDescription()` 函数，`description()` 与 `prompt()` 均返回它。变量已替换（`${GREP_TOOL_NAME}` → `Grep`，`${BASH_TOOL_NAME}` → `Bash`，`${AGENT_TOOL_NAME}` → `Agent`）：

```
A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command. The Grep tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\s+\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use Agent tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use `interface\{\}` to find `interface{}` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like `struct \{[\s\S]*?field`, use `multiline: true`
```

## Input Schema

- `pattern` (string, 必填): "The regular expression pattern to search for in file contents"
- `path` (string, 可选): "File or directory to search in (rg PATH). Defaults to current working directory."
- `glob` (string, 可选): "Glob pattern to filter files (e.g. \"*.js\", \"*.{ts,tsx}\") - maps to rg --glob"
- `output_mode` (enum `content` | `files_with_matches` | `count`, 可选): "Output mode: \"content\" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), \"files_with_matches\" shows file paths (supports head_limit), \"count\" shows match counts (supports head_limit). Defaults to \"files_with_matches\"."
- `-B` (number, 可选): "Number of lines to show before each match (rg -B). Requires output_mode: \"content\", ignored otherwise."
- `-A` (number, 可选): "Number of lines to show after each match (rg -A). Requires output_mode: \"content\", ignored otherwise."
- `-C` (number, 可选): "Alias for context."
- `context` (number, 可选): "Number of lines to show before and after each match (rg -C). Requires output_mode: \"content\", ignored otherwise."
- `-n` (boolean, 可选): "Show line numbers in output (rg -n). Requires output_mode: \"content\", ignored otherwise. Defaults to true."
- `-i` (boolean, 可选): "Case insensitive search (rg -i)"
- `type` (string, 可选): "File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types."
- `head_limit` (number, 可选): "Limit output to first N lines/entries, equivalent to \"| head -N\". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), count (limits count entries). Defaults to 250 when unspecified. Pass 0 for unlimited (use sparingly — large result sets waste context)."
- `offset` (number, 可选): "Skip first N lines/entries before applying head_limit, equivalent to \"| tail -n +N | head -N\". Works across all output modes. Defaults to 0."
- `multiline` (boolean, 可选): "Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false."
