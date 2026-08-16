# FileReadTool

- **工具名**: `Read`（userFacingName: 动态——默认 `Read`；plan 目录文件 `Reading Plan`；agent 输出文件 `Read agent output`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/FileReadTool/`
- **门槛**: 无条件
- **性质**: isReadOnly: `true`；isConcurrencySafe: `true`；`strict: true`
- **searchHint**: `'read files, images, PDFs, notebooks'`

## 描述（模型侧 desc）

`description()` 返回 `DESCRIPTION`：

```
Read a file from the local filesystem.
```

`prompt()` 返回 `renderPromptTemplate(lineFormat, maxSizeInstruction, offsetInstruction)` 拼装结果。运行时参数：
`lineFormat` = `LINE_FORMAT_INSTRUCTION`；`maxSizeInstruction` 仅在 `getDefaultFileReadingLimits().includeMaxSizeInPrompt` 为真时非空（GrowthBook `tengu_amber_wren`，默认关闭）；`offsetInstruction` 默认为 `OFFSET_INSTRUCTION_DEFAULT`（`targetedRangeNudge` 为真时换成 `OFFSET_INSTRUCTION_TARGETED`）。变量已替换：`MAX_LINES_TO_READ` = 2000、`${BASH_TOOL_NAME}` = `Bash`、PDF 页上限 `PDF_MAX_PAGES_PER_READ` = 20。按默认基线（无 maxSize 提示、默认 offset 提示、PDF 支持开启）拼装：

```
Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.
```

**条件拼接段（按源码顺序，逐字）**：

1. `includeMaxSizeInPrompt` 为真时，紧跟 "By default, it reads up to 2000 lines starting from the beginning of the file" 后（无换行）拼接：

   ```
   . Files larger than <formatFileSize(limits.maxSizeBytes)> will return an error; use offset and limit for larger files
   ```

   （`maxSizeBytes` 默认 `MAX_OUTPUT_SIZE` = 256 KB，可经 GrowthBook `tengu_amber_wren` 覆盖。）

2. `targetedRangeNudge` 为真时，第 3 条 usage 替换为（`OFFSET_INSTRUCTION_TARGETED`）：

   ```
   - When you already know which part of the file you need, only read that part. This can be important for larger files.
   ```

3. `isPDFSupported()` 为假时，PDF 一行省略。

## Input Schema

- `file_path` (string, 必填): "The absolute path to the file to read"
- `offset` (number, 可选, 经 `semanticNumber` 预处理): "The line number to start reading from. Only provide if the file is too large to read at once"
- `limit` (number, 可选, 经 `semanticNumber` 预处理): "The number of lines to read. Only provide if the file is too large to read at once."
- `pages` (string, 可选): "Page range for PDF files (e.g., \"1-5\", \"3\", \"10-20\"). Only applicable to PDF files. Maximum 20 pages per request."
