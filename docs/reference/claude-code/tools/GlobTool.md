# GlobTool

- **工具名**: `Glob`（userFacingName: `Search`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/GlobTool/`
- **门槛**: 仅当 `hasEmbeddedSearchTools()` 为 false 时注册（ant 原生构建内嵌 bfs/ugrep 时不注册，见 `vendor/claude-code/src/tools.ts` getAllBaseTools：`...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool])`）
- **性质**: 只读（`isReadOnly: true`）；并发安全（`isConcurrencySafe: true`）

## 描述（模型侧 desc）

`prompt.ts` 中 `DESCRIPTION` 常量，`description()` 与 `prompt()` 均返回它：

```
- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
```

## Input Schema

- `pattern` (string, 必填): "The glob pattern to match files against"
- `path` (string, 可选): "The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter \"undefined\" or \"null\" - simply omit it for the default behavior. Must be a valid directory path if provided."
