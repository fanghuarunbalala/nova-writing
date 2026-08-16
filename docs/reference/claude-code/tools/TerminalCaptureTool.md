# TerminalCaptureTool

- **工具名**: `TerminalCapture`（userFacingName: `TerminalCapture`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/TerminalCaptureTool/`
- **门槛**: `feature('TERMINAL_PANEL')`
- **性质**: 只读（isReadOnly: true）、并发安全（isConcurrencySafe: true）

## 描述（模型侧 desc）

来源：`TerminalCaptureTool.ts` 内联。`description()` 返回：

```text
Capture output from a terminal panel
```

`prompt()` 返回：

```text
Capture the current content of a terminal panel. Use this to read output from terminal sessions running in the terminal panel UI.

Guidelines:
- Specify the number of lines to capture (default 50)
- Optionally target a specific panel by ID
- Content is returned as plain text
```

## Input Schema

- `lines` (number, 可选): "Number of lines to capture from the terminal. Defaults to 50."
- `panel_id` (string, 可选): "ID of the terminal panel to capture from. Defaults to the active panel."
