# CCB runtime.files 参考契约（Read / Glob / Write / Edit）

> 来源：Claude Code v2.1.141 二进制公开 schema 与行为（2026-05-13 build）。
> 用途：Novel compose 模式 `runtime.files` 的实现对照参考——参数与行为对齐 CCB，**代码自研**
> （CCB 为压缩混淆的闭源专有实现，且与我们的 tool 协议/沙箱架构不兼容，不照抄代码）。
> 相关文档：`docs/novel-compose-mode-plan.md`。

## Read

- 描述：`Read a file from the local filesystem.`
- 行为要点（原文）：
  - `Results are returned using cat -n format, with line numbers starting at 1`
  - `You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters`
  - 超限返回截断错误（`FileTooLargeError`：use offset and limit to read specific portions, or search）。
- 参数（JSON Schema 形状）：

```json
{
  "type": "object",
  "properties": {
    "file_path": { "type": "string" },
    "offset": { "type": "integer", "minimum": 0 },
    "limit": { "type": "integer", "minimum": 1 }
  },
  "required": ["file_path"],
  "additionalProperties": false
}
```

- 我们的 v1 实现：同参数；作用域 = design 目录；返回 `{ content(带行号, cat -n), sizeBytes, totalLines, truncated }`；offset/limit 按行生效。

## Write

- 描述：`Write a file to the local filesystem.`
- 行为要点：
  - 整文件写入；
  - normalize 阶段对 `.md` / `.mdx` 路径有特判（检测扩展名）——v1 我们**不做**格式处理，直接写原文。
- 参数：

```json
{
  "type": "object",
  "properties": {
    "file_path": { "type": "string" },
    "content": { "type": "string" }
  },
  "required": ["file_path", "content"],
  "additionalProperties": false
}
```

- 我们的 v1 实现：同参数；`file_path` 必须等于当前会话 designFilePath；原子写入（tmp + rename）。

## Edit

- 描述：（Edit a file）
- 行为要点：
  - 参数含 `file_path` / `old_string` / `new_string` / `replace_all?`；
  - normalize 接受兼容别名 `old_str` / `new_str`（自动转正）；
  - `replace_all` 缺省 `false`：替换**第一个**匹配；`true`：全部替换；
  - `old_string` 未命中 → 报错，提示提供更精确上下文。
- 参数：

```json
{
  "type": "object",
  "properties": {
    "file_path": { "type": "string" },
    "old_string": { "type": "string" },
    "new_string": { "type": "string" },
    "replace_all": { "type": "boolean" }
  },
  "required": ["file_path", "old_string", "new_string"],
  "additionalProperties": false
}
```

- 我们的 v1 实现：同参数 + 兼容别名；`file_path` 必须等于当前会话 designFilePath；未命中报
  `NOVEL_DESIGN_EDIT_MISSING`；多处命中且 `replace_all=false` 时替换第一个（对齐 CCB 语义，不做歧义报错）。

## Glob

- 描述：`Supports glob patterns like "**/*.js" or "src/**/*.ts" - Returns matching file paths sorted by modification time - Use this tool when you need to find files by name patterns - When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead`
- 行为要点：返回匹配**绝对路径**，按 mtime 排序；支持 `**` / `*` / `?`。
- 参数：

```json
{
  "type": "object",
  "properties": {
    "pattern": { "type": "string" }
  },
  "required": ["pattern"],
  "additionalProperties": false
}
```

- 我们的 v1 实现：同参数；基准目录 = design 目录；禁止 `..` 逃逸与绝对路径；mtime 降序；返回绝对路径。

## 实现约束

- 只参考上述公开契约（参数名、类型、行为语义），代码全部自研；
- 遵循仓库工具协议：`schemas.ts`（TypeBox）+ `defineTool` + `ToolService` + manifest 组 `runtime.files`；
- 路径沙箱在 ToolService 内统一 `realpath` 校验（防 `../` / symlink 逃逸）。
