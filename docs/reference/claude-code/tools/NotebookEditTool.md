# NotebookEditTool

- **工具名**: `NotebookEdit`（userFacingName: `Edit Notebook`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/NotebookEditTool/`
- **门槛**: 无条件（`vendor/claude-code/src/tools.ts` getAllBaseTools 第 231 行直接列出）
- **性质**: `shouldDefer: true`

## 描述（模型侧 desc）

`prompt.ts` 中 `DESCRIPTION` 常量，`description()` 返回它：

```
Replace the contents of a specific cell in a Jupyter notebook.
```

`prompt()` 返回 `prompt.ts` 中 `PROMPT` 常量：

```
Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source. Jupyter notebooks are interactive documents that combine code, text, and visualizations, commonly used for data analysis and scientific computing. The notebook_path parameter must be an absolute path, not a relative path. The cell_number is 0-indexed. Use edit_mode=insert to add a new cell at the index specified by cell_number. Use edit_mode=delete to delete the cell at the index specified by cell_number.
```

## Input Schema

- `notebook_path` (string, 必填): "The absolute path to the Jupyter notebook file to edit (must be absolute, not relative)"
- `cell_id` (string, 可选): "The ID of the cell to edit. When inserting a new cell, the new cell will be inserted after the cell with this ID, or at the beginning if not specified."
- `new_source` (string, 必填): "The new source for the cell"
- `cell_type` (enum `code` | `markdown`, 可选): "The type of the cell (code or markdown). If not specified, it defaults to the current cell type. If using edit_mode=insert, this is required."
- `edit_mode` (enum `replace` | `insert` | `delete`, 可选): "The type of edit to make (replace, insert, delete). Defaults to replace."
