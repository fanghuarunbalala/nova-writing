# PowerShellTool

- **工具名**: `PowerShell`（userFacingName: `PowerShell`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/PowerShellTool/`
- **门槛**: `isPowerShellToolEnabled()`（`vendor/claude-code/src/utils/shell/shellToolUtils.ts`）——仅 Windows 平台，且 `CLAUDE_CODE_USE_POWERSHELL_TOOL` 未设为 falsy（0/false/off）时开启；非 Windows 恒关
- **性质**: 只读/并发安全均为动态判断（`isConcurrencySafe(input) = isReadOnly(input)`，`isReadOnly(input)` 基于命令安全启发式与 `isReadOnlyCommand`）；`strict: true`

## 描述（模型侧 desc）

无独立 `DESCRIPTION` 常量。`description({ description })` 返回 `description || 'Run PowerShell command'`——即取本次调用的 `description` 参数，缺失时回退 `Run PowerShell command`。

`prompt()` 返回 `prompt.ts` 中 `getPrompt()` 的拼装文本。以下为变量替换后的最终文本（默认值：timeout 上限 `${getMaxTimeoutMs()}` → `600000`，默认 `${getDefaultTimeoutMs()}` → `120000`，输出上限 `${getMaxOutputLength()}` → `30000`；`${POWERSHELL_TOOL_NAME}` → `PowerShell`，`${GLOB_TOOL_NAME}` → `Glob`，`${GREP_TOOL_NAME}` → `Grep`，`${FILE_READ_TOOL_NAME}` → `Read`，`${FILE_EDIT_TOOL_NAME}` → `Edit`，`${FILE_WRITE_TOOL_NAME}` → `Write`；background/sleep 两段在未设置 `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` 时存在，已含）：

```
Executes a given PowerShell command with optional timeout. Working directory persists between commands; shell state (variables, functions) does not.

IMPORTANT: This tool is for terminal operations via PowerShell: git, npm, docker, and PS cmdlets. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

<版本段：运行时按检测到的 PowerShell 版本三选一，见下方三个分支>

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use `Get-ChildItem` (or `ls`) to verify the parent directory exists and is the correct location

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes
   - Capture the output of the command.

PowerShell Syntax Notes:
   - Variables use $ prefix: $myVar = "value"
   - Escape character is backtick (`), not backslash
   - Use Verb-Noun cmdlet naming: Get-ChildItem, Set-Location, New-Item, Remove-Item
   - Common aliases: ls (Get-ChildItem), cd (Set-Location), cat (Get-Content), rm (Remove-Item)
   - Pipe operator | works similarly to bash but passes objects, not text
   - Use Select-Object, Where-Object, ForEach-Object for filtering and transformation
   - String interpolation: "Hello $name" or "Hello $($obj.Property)"
   - Registry access uses PSDrive prefixes: `HKLM:\SOFTWARE\...`, `HKCU:\...` — NOT raw `HKEY_LOCAL_MACHINE\...`
   - Environment variables: read with `$env:NAME`, set with `$env:NAME = "value"` (NOT `Set-Variable` or bash `export`)
   - Call native exe with spaces in path via call operator: `& "C:\Program Files\App\app.exe" arg1 arg2`

Interactive and blocking commands (will hang — this tool runs with -NonInteractive):
   - NEVER use `Read-Host`, `Get-Credential`, `Out-GridView`, `$Host.UI.PromptForChoice`, or `pause`
   - Destructive cmdlets (`Remove-Item`, `Stop-Process`, `Clear-Content`, etc.) may prompt for confirmation. Add `-Confirm:$false` when you intend the action to proceed. Use `-Force` for read-only/hidden items.
   - Never use `git rebase -i`, `git add -i`, or other commands that open an interactive editor

Passing multiline strings (commit messages, file content) to native executables:
   - Use a single-quoted here-string so PowerShell does not expand `$` or backticks inside. The closing `'@` MUST be at column 0 (no leading whitespace) on its own line — indenting it is a parse error:
<example>
git commit -m @'
Commit message here.
Second line with $literal dollar signs.
'@
</example>
   - Use `@'...'@` (single-quoted, literal) not `@"..."@` (double-quoted, interpolated) unless you need variable expansion
   - For arguments containing `-`, `@`, or other characters PowerShell parses as operators, use the stop-parsing token: `git log --% --format=%H`

Usage notes:
  - The command argument is required.
  - You can specify an optional timeout in milliseconds (up to 600000ms / 10 minutes). If not specified, commands will timeout after 120000ms (2 minutes).
  - It is very helpful if you write a clear, concise description of what this command does.
  - If the output exceeds 30000 characters, output will be truncated before being returned to you.
  - You can use the `run_in_background` parameter to run the command in the background. Only use this if you don't need the result immediately and are OK being notified when the command completes later. You do not need to check the output right away - you'll be notified when it finishes.
  - Avoid using PowerShell to run commands that have dedicated tools, unless explicitly instructed:
    - File search: Use Glob (NOT Get-ChildItem -Recurse)
    - Content search: Use Grep (NOT Select-String)
    - Read files: Use Read (NOT Get-Content)
    - Edit files: Use Edit
    - Write files: Use Write (NOT Set-Content/Out-File)
    - Communication: Output text directly (NOT Write-Output/Write-Host)
  - When issuing multiple commands:
    - If the commands are independent and can run in parallel, make multiple PowerShell tool calls in a single message.
    - If the commands depend on each other and must run sequentially, chain them in a single PowerShell call (see edition-specific chaining syntax above).
    - Use `;` only when you need to run commands sequentially but don't care if earlier commands fail.
    - DO NOT use newlines to separate commands (newlines are ok in quoted strings and here-strings)
  - Do NOT prefix commands with `cd` or `Set-Location` -- the working directory is already set to the correct project directory automatically.
  - Avoid unnecessary `Start-Sleep` commands:
    - Do not sleep between commands that can run immediately — just run them.
    - If your command is long running and you would like to be notified when it finishes — simply run your command using `run_in_background`. There is no need to sleep in this case.
    - Do not retry failing commands in a sleep loop — diagnose the root cause or consider an alternative approach.
    - If waiting for a background task you started with `run_in_background`, you will be notified when it completes — do not poll.
    - If you must poll an external process, use a check command rather than sleeping first.
    - If you must sleep, keep the duration short (1-5 seconds) to avoid blocking the user.
  - For git commands:
    - Prefer to create a new commit rather than amending an existing commit.
    - Before running destructive operations (e.g., git reset --hard, git push --force, git checkout --), consider whether there is a safer alternative that achieves the same goal. Only use destructive operations when they are truly the best approach.
    - Never skip hooks (--no-verify) or bypass signing (--no-gpg-sign, -c commit.gpgsign=false) unless the user has explicitly asked for it. If a hook fails, investigate and fix the underlying issue.
```

版本段 `getEditionSection(edition)` 三个分支（运行时按 `getPowerShellEdition()` 检测结果三选一，检测未完成或 PS 未安装时走第三分支）：

- `desktop`（Windows PowerShell 5.1，powershell.exe）：

```
PowerShell edition: Windows PowerShell 5.1 (powershell.exe)
   - Pipeline chain operators `&&` and `||` are NOT available — they cause a parser error. To run B only if A succeeds: `A; if ($?) { B }`. To chain unconditionally: `A; B`.
   - Ternary (`?:`), null-coalescing (`??`), and null-conditional (`?.`) operators are NOT available. Use `if/else` and explicit `$null -eq` checks instead.
   - Avoid `2>&1` on native executables. In 5.1, redirecting a native command's stderr inside PowerShell wraps each line in an ErrorRecord (NativeCommandError) and sets `$?` to `$false` even when the exe returned exit code 0. stderr is already captured for you — don't redirect it.
   - Default file encoding is UTF-16 LE (with BOM). When writing files other tools will read, pass `-Encoding utf8` to `Out-File`/`Set-Content`.
   - `ConvertFrom-Json` returns a PSCustomObject, not a hashtable. `-AsHashtable` is not available.
```

- `core`（PowerShell 7+，pwsh）：

```
PowerShell edition: PowerShell 7+ (pwsh)
   - Pipeline chain operators `&&` and `||` ARE available and work like bash. Prefer `cmd1 && cmd2` over `cmd1; cmd2` when cmd2 should only run if cmd1 succeeds.
   - Ternary (`$cond ? $a : $b`), null-coalescing (`??`), and null-conditional (`?.`) operators are available.
   - Default file encoding is UTF-8 without BOM.
```

- `unknown`（默认保守分支）：

```
PowerShell edition: unknown — assume Windows PowerShell 5.1 for compatibility
   - Do NOT use `&&`, `||`, ternary `?:`, null-coalescing `??`, or null-conditional `?.`. These are PowerShell 7+ only and parser-error on 5.1.
   - To chain commands conditionally: `A; if ($?) { B }`. Unconditionally: `A; B`.
```

## Input Schema

- `command` (string, 必填): "The PowerShell command to execute"
- `timeout` (number, 可选): "Optional timeout in milliseconds (max 600000)"（原文为模板字符串 `` `Optional timeout in milliseconds (max ${getMaxTimeoutMs()})` ``，默认上限 600000）
- `description` (string, 可选): "Clear, concise description of what this command does in active voice."
- `run_in_background` (boolean, 可选): "Set to true to run this command in the background. Use Read to read the output later."（当 `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` 为真时此字段从 schema 中 omit）
- `dangerouslyDisableSandbox` (boolean, 可选): "Set this to true to dangerously override sandbox mode and run commands without sandboxing."
