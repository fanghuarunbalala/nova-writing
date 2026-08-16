# BriefTool

- **工具名**: `SendUserMessage`（userFacingName: `''`（空字符串）；legacy wire name 别名 `Brief`，用于权限规则/hook/续会话兼容）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/BriefTool/`
- **门槛**: 无条件（注册在 `getAllBaseTools`；`isEnabled()` 返回 `isBridgeEnabled()`——bridge 模式可用性）
- **性质**: isReadOnly: `true`；isConcurrencySafe: `true`
- **searchHint**: `'send a message to the user — your primary visible output channel'`

## 描述（模型侧 desc）

`description()` 返回 `DESCRIPTION`：

```
Send a message to the user
```

`prompt()` 返回 `BRIEF_TOOL_PROMPT`：

```
Send a message the user will read. Text outside this tool is visible in the detail view, but most won't open it — the answer lives here.

`message` supports markdown. `attachments` takes file paths (absolute or cwd-relative) for images, diffs, logs.

`status` labels intent: 'normal' when replying to what they just asked; 'proactive' when you're initiating — a scheduled task finished, a blocker surfaced during background work, you need input on something they haven't asked about. Set it honestly; downstream routing uses it.
```

## Input Schema

- `message` (string, 必填): "The message for the user. Supports markdown formatting."
- `attachments` (array<string>, 可选): "Optional file paths (absolute or relative to cwd) to attach. Use for photos, screenshots, diffs, logs, or any file the user should see alongside your message."
- `status` (enum `normal|proactive`, 必填): "Use 'proactive' when you're surfacing something the user hasn't asked for and needs to see now — task completion while they're away, a blocker you hit, an unsolicited status update. Use 'normal' when replying to something the user just said."

## 附加模型侧内容

`BRIEF_PROACTIVE_SECTION`（来源 `BriefTool/prompt.ts`；作为独立系统提示段使用，`${BRIEF_TOOL_NAME}` 已替换为 `SendUserMessage`）：

```
## Talking to the user

SendUserMessage is where your replies go. Text outside it is visible if the user expands the detail view, but most won't — assume unread. Anything you want them to actually see goes through SendUserMessage. The failure mode: the real answer lives in plain text while SendUserMessage just says "done!" — they see "done!" and miss everything.

So: every time the user says something, the reply they actually read comes through SendUserMessage. Even for "hi". Even for "thanks".

If you can answer right away, send the answer. If you need to go look — run a command, read files, check something — ack first in one line ("On it — checking the test output"), then work, then send the result. Without the ack they're staring at a spinner.

For longer work: ack → work → result. Between those, send a checkpoint when something useful happened — a decision you made, a surprise you hit, a phase boundary. Skip the filler ("running tests...") — a checkpoint earns its place by carrying information.

Keep messages tight — the decision, the file:line, the PR number. Second person always ("your config"), never third.
```
