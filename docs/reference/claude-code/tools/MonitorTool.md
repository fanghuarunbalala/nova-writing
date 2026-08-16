# MonitorTool

- **工具名**: `Monitor`（userFacingName: `Monitor`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/MonitorTool/`
- **门槛**: `feature('MONITOR_TOOL')`（`vendor/claude-code/src/tools.ts` getAllBaseTools 中 `...(MonitorTool ? [MonitorTool] : [])`）
- **性质**: 非只读（`isReadOnly: false`——执行 shell 命令可能有副作用）；并发安全（`isConcurrencySafe: true`）；`strict: true`

## 描述（模型侧 desc）

`description()` 返回（定义于 `MonitorTool.tsx` 的 `buildTool` 中）：

```
Start a long-running background monitor
```

`prompt()` 返回（同文件 `buildTool` 中内联文本）：

```
Use Monitor to start a long-running background process that streams output (watching logs, polling APIs, tailing files, etc.). The command runs in the background and you receive a notification when it exits. Use the Read tool with the output file path to check its output at any time.

Guidelines:
- Use Monitor for commands that produce ongoing streaming output: `tail -f`, log watchers, file watchers, API polling loops, `watch` commands
- Do NOT use Monitor for one-shot commands that finish quickly — use Bash for those
- Do NOT use Monitor for commands that need interactive input — they will hang
- The description should clearly explain what is being monitored
- You'll get a task notification when the monitor process exits (stream ends, script fails, or killed)
- To check output at any time, use Read on the output file path returned by this tool

Examples:
- Watching a log file: command="tail -f /var/log/app.log", description="Watch app log for errors"
- Polling an API: command="while true; do curl -s http://localhost:3000/health; sleep 5; done", description="Poll health endpoint every 5s"
- Watching for file changes: command="inotifywait -m -r ./src", description="Watch src directory for file changes"
```

## Input Schema

- `command` (string, 必填): "The shell command to run as a long-running monitor. Should produce streaming output (e.g., tail -f, watch, polling loops)."
- `description` (string, 必填): "Clear, concise description of what this monitor watches. Used as the label in the background tasks UI."
