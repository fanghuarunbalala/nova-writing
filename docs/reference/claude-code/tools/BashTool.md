# BashTool

- **工具名**: `Bash`（userFacingName: 默认 `Bash`；`CLAUDE_CODE_BASH_SANDBOX_SHOW_INDICATOR` 为真且 `shouldUseSandbox(input)` 时显示 `SandboxedBash`；sed 原位编辑按文件编辑样式显示）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/BashTool/`
- **门槛**: 无条件
- **性质**: isReadOnly(input): 动态——对输入命令做只读约束检查（`checkReadOnlyConstraints`）判定；isConcurrencySafe(input): 等于 `isReadOnly(input)`；`strict: true`
- **searchHint**: `'execute shell commands'`

## 描述（模型侧 desc）

`description({ description })` 动态返回：`description || 'Run shell command'`（description 来自宿主注入，默认第一行）。
`prompt()` 返回 `getSimplePrompt()` 拼装结果。以下为按默认基线配置（ant 嵌入式搜索工具关闭、
`MONITOR_TOOL` feature 关闭、沙箱未启用、git 指令未禁用、非 ant 用户、非 undercover、
后台任务未禁用、超时默认值）拼装后的最终文本，变量已替换
（`Bash`/`Glob`/`Grep`/`Read`/`Edit`/`Write`/`TodoWrite`/`Agent`；默认超时
`getDefaultBashTimeoutMs()`=120000ms（2 分钟）、最大 `getMaxBashTimeoutMs()`=600000ms（10 分钟），
可由 `BASH_DEFAULT_TIMEOUT_MS`/`BASH_MAX_TIMEOUT_MS` 环境变量覆盖）：

```
Executes a given bash command and returns its output.

The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile (bash or zsh).

IMPORTANT: Avoid using this tool to run `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user:
- File search: Use Glob (NOT find or ls)
- Content search: Use Grep (NOT grep or rg)
- Read files: Use Read (NOT cat/head/tail)
- Edit files: Use Edit (NOT sed/awk)
- Write files: Use Write (NOT echo >/cat <<EOF)
- Communication: Output text directly (NOT echo/printf)
While the Bash tool can do similar things, it’s better to use the built-in tools as they provide a better user experience and make it easier to review tool calls and give permission.

# Instructions
- If your command will create new directories or files, first use this tool to run `ls` to verify the parent directory exists and is the correct location.
- Always quote file paths that contain spaces with double quotes in your command (e.g., cd "path with spaces/file.txt")
- Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of `cd`. You may use `cd` if the User explicitly requests it.
- You may specify an optional timeout in milliseconds (up to 600000ms / 10 minutes). By default, your command will timeout after 120000ms (2 minutes).
- You can use the `run_in_background` parameter to run the command in the background. Only use this if you don't need the result immediately and are OK being notified when the command completes later. You do not need to check the output right away - you'll be notified when it finishes. You do not need to use '&' at the end of the command when using this parameter.
- When issuing multiple commands:
  - If the commands are independent and can run in parallel, make multiple Bash tool calls in a single message. Example: if you need to run "git status" and "git diff", send a single message with two Bash tool calls in parallel.
  - If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together.
  - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail.
  - DO NOT use newlines to separate commands (newlines are ok in quoted strings).
- For git commands:
  - Prefer to create a new commit rather than amending an existing commit.
  - Before running destructive operations (e.g., git reset --hard, git push --force, git checkout --), consider whether there is a safer alternative that achieves the same goal. Only use destructive operations when they are truly the best approach.
  - Never skip hooks (--no-verify) or bypass signing (--no-gpg-sign, -c commit.gpgsign=false) unless the user has explicitly asked for it. If a hook fails, investigate and fix the underlying issue.
- Avoid unnecessary `sleep` commands:
  - Do not sleep between commands that can run immediately — just run them.
  - For long-running commands, use `run_in_background` — you will be notified when it completes. Do not poll.
  - Do not retry failing commands in a sleep loop — diagnose the root cause.
  - If you must sleep, keep the duration short (1-5 seconds) to avoid blocking the user.
```

**条件拼接段（按源码顺序，逐字）**：

1. ant 构建嵌入 bfs/ugrep（`hasEmbeddedSearchTools()`）时：省略前两条工具偏好项，
   `avoidCommands` 列表去掉 `find`/`grep`（仅 `` `cat`, `head`, `tail`, `sed`, `awk`, or `echo` ``），
   且 "Avoid unnecessary `sleep` commands:" 段追加一条：

   ```
   - When using `find -regex` with alternation, put the longest alternative first. Example: use `'.*\\.\\(tsx\\|ts\\)'` not `'.*\\.\\(ts\\|tsx\\)'` — the second form silently skips `.tsx` files.
   ```

2. `MONITOR_TOOL` feature 开启时，"Avoid unnecessary `sleep` commands:" 段替换为：

   ```
   - Do not sleep between commands that can run immediately — just run them.
   - Use the Monitor tool to stream events from a background process (each stdout line is a notification). For one-shot "wait until done," use Bash with run_in_background instead.
   - For long-running commands, use `run_in_background` — you will be notified when it completes. Do not poll.
   - Do not retry failing commands in a sleep loop — diagnose the root cause.
   - `sleep N` as the first command with N ≥ 2 is blocked. If you need a delay (rate limiting, deliberate pacing), keep it under 2 seconds.
   ```

3. `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` 为真时，`run_in_background` 用法说明省略。

4. 沙箱启用时（`SandboxManager.isSandboxingEnabled()`），在 Instructions 段后追加 `## Command sandbox` 段：

   ```
   ## Command sandbox
   By default, your command will be run in a sandbox. This sandbox controls which directories and network hosts commands may access or modify without an explicit override.

   The sandbox has the following restrictions:
   Filesystem: <jsonStringify(filesystemConfig)>
   Network: <jsonStringify(networkConfig)>
   [Ignored violations: <jsonStringify(ignoreViolations)>]
   ```

   允许非沙箱命令时（`areUnsandboxedCommandsAllowed()`）追加：

   ```
   - You should always default to running commands within the sandbox. Do NOT attempt to set `dangerouslyDisableSandbox: true` unless:
     - The user *explicitly* asks you to bypass sandbox
     - A specific command just failed and you see evidence of sandbox restrictions causing the failure. Note that commands can fail for many reasons unrelated to the sandbox (missing files, wrong arguments, network issues, etc.).
   - Evidence of sandbox-caused failures includes:
     - "Operation not permitted" errors for file/network operations
     - Access denied to specific paths outside allowed directories
     - Network connection failures to non-whitelisted hosts
     - Unix socket connection errors
   - When you see evidence of sandbox-caused failure:
     - Immediately retry with `dangerouslyDisableSandbox: true` (don't ask, just do it)
     - Briefly explain what sandbox restriction likely caused the failure. Be sure to mention that the user can use the `/sandbox` command to manage restrictions.
     - This will prompt the user for permission
   - Treat each command you execute with `dangerouslyDisableSandbox: true` individually. Even if you have recently run a command with this setting, you should default to running future commands within the sandbox.
   - Do not suggest adding sensitive paths like ~/.bashrc, ~/.zshrc, ~/.ssh/*, or credential files to the sandbox allowlist.
   ```

   禁止非沙箱命令时替换为：

   ```
   - All commands MUST run in sandbox mode - the `dangerouslyDisableSandbox` parameter is disabled by policy.
   - Commands cannot run outside the sandbox under any circumstances.
   - If a command fails due to sandbox restrictions, work with the user to adjust sandbox settings instead.
   ```

   两种情形均追加：

   ```
   - For temporary files, always use the `$TMPDIR` environment variable. TMPDIR is automatically set to the correct sandbox-writable directory in sandbox mode. Do NOT use `/tmp` directly - use `$TMPDIR` instead.
   ```

5. git 指令启用（`shouldIncludeGitInstructions()`）时追加 git 段（见「附加模型侧内容」）。

## Input Schema

模型可见 schema = `fullInputSchema()` 去掉 `_simulatedSedEdit`（内部字段，sed 预览审批后由
`SedEditPermissionRequest` 注入，不让模型直接传，防绕过权限/沙箱）；后台任务被禁用时
（`isBackgroundTasksDisabled`）再去掉 `run_in_background`。

- `command` (string, 必填): "The command to execute"
- `timeout` (number, 可选, 经 `semanticNumber` 预处理): "Optional timeout in milliseconds (max 600000)"
- `description` (string, 可选): 多行文本，原文：

  ```
  Clear, concise description of what this command does in active voice. Never use words like "complex" or "risk" in the description - just describe what it does.

  For simple commands (git, npm, standard CLI tools), keep it brief (5-10 words):
  - ls → "List files in current directory"
  - git status → "Show working tree status"
  - npm install → "Install package dependencies"

  For commands that are harder to parse at a glance (piped commands, obscure flags, etc.), add enough context to clarify what it does:
  - find . -name "*.tmp" -exec rm {} \; → "Find and delete all .tmp files recursively"
  - git reset --hard origin/main → "Discard all local changes and match remote main"
  - curl -s url | jq '.data[]' → "Fetch JSON from URL and extract data array elements"
  ```

- `run_in_background` (boolean, 可选, 经 `semanticBoolean` 预处理): "Set to true to run this command in the background. Use Read to read the output later."
- `dangerouslyDisableSandbox` (boolean, 可选, 经 `semanticBoolean` 预处理): "Set this to true to dangerously override sandbox mode and run commands without sandboxing."
- `_simulatedSedEdit` (object `{filePath, newContent}`, 可选, **已从模型可见 schema 省略**): "Internal: pre-computed sed edit result from preview"

## 附加模型侧内容

`getCommitAndPRInstructions()`（来源 `BashTool/prompt.ts`，git 指令启用时追加；`<commitAttribution>`/`<prAttribution>` 来自 `getAttributionTexts()`，默认形如 `Co-Authored-By: <模型名> <email>` 与 `🤖 Generated with [Claude Code Best](<PRODUCT_URL>)`，随设置/远程会话变化）。

**非 ant 用户版（完整内联指令）**：

```
# Committing changes with git

Only create commits when requested by the user. If unclear, ask first. When the user asks you to create a new git commit, follow these steps carefully:

You can call multiple tools in a single response. When multiple independent pieces of information are requested and all commands are likely to succeed, run multiple tool calls in parallel for optimal performance. The numbered steps below indicate which commands should be batched in parallel.

Git Safety Protocol:
- NEVER update the git config
- NEVER run destructive git commands (push --force, reset --hard, checkout ., restore ., clean -f, branch -D) unless the user explicitly requests these actions. Taking unauthorized destructive actions is unhelpful and can result in lost work, so it's best to ONLY run these commands when given direct instructions 
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it
- NEVER run force push to main/master, warn the user if they request it
- CRITICAL: Always create NEW commits rather than amending, unless the user explicitly requests a git amend. When a pre-commit hook fails, the commit did NOT happen — so --amend would modify the PREVIOUS commit, which may result in destroying work or losing previous changes. Instead, after hook failure, fix the issue, re-stage, and create a NEW commit
- When staging files, prefer adding specific files by name rather than using "git add -A" or "git add .", which can accidentally include sensitive files (.env, credentials) or large binaries
- NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive

1. Run the following bash commands in parallel, each using the Bash tool:
  - Run a git status command to see all untracked files. IMPORTANT: Never use the -uall flag as it can cause memory issues on large repos.
  - Run a git diff command to see both staged and unstaged changes that will be committed.
  - Run a git log command to see recent commit messages, so that you can follow this repository's commit message style.
2. Analyze all staged changes (both previously staged and newly added) and draft a commit message:
  - Summarize the nature of the changes (eg. new feature, enhancement to an existing feature, bug fix, refactoring, test, docs, etc.). Ensure the message accurately reflects the changes and their purpose (i.e. "add" means a wholly new feature, "update" means an enhancement to an existing feature, "fix" means a bug fix, etc.).
  - Do not commit files that likely contain secrets (.env, credentials.json, etc). Warn the user if they specifically request to commit those files
  - Draft a concise (1-2 sentences) commit message that focuses on the "why" rather than the "what"
  - Ensure it accurately reflects the changes and their purpose
3. Run the following commands in parallel:
   - Add relevant untracked files to the staging area.
   - Create the commit with a message<commitAttribution 拼接>
   - Run git status after the commit completes to verify success.
   Note: git status depends on the commit completing, so run it sequentially after the commit.
4. If the commit fails due to pre-commit hook: fix the issue and create a NEW commit

Important notes:
- NEVER run additional commands to read or explore code, besides git bash commands
- NEVER use the TodoWrite or Agent tools
- DO NOT push to the remote repository unless the user explicitly asks you to do so
- IMPORTANT: Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported.
- IMPORTANT: Do not use --no-edit with git rebase commands, as the --no-edit flag is not a valid option for git rebase.
- If there are no changes to commit (i.e., no untracked files and no modifications), do not create an empty commit
- In order to ensure good formatting, ALWAYS pass the commit message via a HEREDOC, a la this example:
<example>
git commit -m "$(cat <<'EOF'
   Commit message here.<commitAttribution 拼接>
   EOF
   )"
</example>

# Creating pull requests
Use the gh command via the Bash tool for ALL GitHub-related tasks including working with issues, pull requests, checks, and releases. If given a Github URL use the gh command to get the information needed.

IMPORTANT: When the user asks you to create a pull request, follow these steps carefully:

1. Run the following bash commands in parallel using the Bash tool, in order to understand the current state of the branch since it diverged from the main branch:
   - Run a git status command to see all untracked files (never use -uall flag)
   - Run a git diff command to see both staged and unstaged changes that will be committed
   - Check if the current branch tracks a remote branch and is up to date with the remote, so you know if you need to push to the remote
   - Run a git log command and `git diff [base-branch]...HEAD` to understand the full commit history for the current branch (from the time it diverged from the base branch)
2. Analyze all changes that will be included in the pull request, making sure to look at all relevant commits (NOT just the latest commit, but ALL commits that will be included in the pull request!!!), and draft a pull request title and summary:
   - Keep the PR title short (under 70 characters)
   - Use the description/body for details, not the title
3. Run the following commands in parallel:
   - Create new branch if needed
   - Push to remote with -u flag if needed
   - Create PR using gh pr create with the format below. Use a HEREDOC to pass the body to ensure correct formatting.
<example>
gh pr create --title "the pr title" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points>

## Test plan
[Bulleted markdown checklist of TODOs for testing the pull request...]<prAttribution 拼接>
EOF
)"
</example>

Important:
- DO NOT use the TodoWrite or Agent tools
- Return the PR URL when you're done, so the user can see it

# Other common operations
- View comments on a Github PR: gh api repos/foo/bar/pulls/123/comments
```

**ant 用户版（精简版，指向 skills）**：

```
# Git operations

For git commits and pull requests, use the `/commit` and `/commit-push-pr` skills:
- `/commit` - Create a git commit with staged changes
- `/commit-push-pr` - Commit, push, and create a pull request

These skills handle git safety protocols, proper commit message formatting, and PR creation.

Before creating a pull request, run `/simplify` to review your changes, then test end-to-end (e.g. via `/tmux` for interactive features).

IMPORTANT: NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it.

Use the gh command via the Bash tool for other GitHub-related tasks including working with issues, checks, and releases. If given a Github URL use the gh command to get the information needed.

# Other common operations
- View comments on a Github PR: gh api repos/foo/bar/pulls/123/comments
```

（ant 且 undercover 时，前置 `getUndercoverInstructions()` 内容 + 换行。）
