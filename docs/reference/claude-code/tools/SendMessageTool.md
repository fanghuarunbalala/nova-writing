# SendMessageTool

- **工具名**: `SendMessage`（userFacingName: `SendMessage`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/SendMessageTool/`
- **门槛**: 无条件（getAllBaseTools 中直接调用 `getSendMessageTool()`，lazy require 仅为打破循环依赖；`isEnabled() → true`）。`alwaysLoad: isAgentSwarmsEnabled()`（swarms 开启时随核心工具直接加载），其余场景 `shouldDefer: true`
- **性质**: `isReadOnly(input)` 仅当 `message` 为纯字符串（结构化消息为写操作）；isConcurrencySafe 未定义（默认 false）

## 描述（模型侧 desc）

`description()` 返回常量 `DESCRIPTION`（prompt.ts）：

```
Send a message to another agent
```

模型侧 prompt（`prompt()` 返回 `getPrompt()`，prompt.ts，按 `feature('UDS_INBOX')` 构建时开关拼接；以下为拼装后的完整文本，UDS 开启版含 `## Cross-session` 段与两行 uds/bridge 表格）：

````
# SendMessage

Send a message to another agent.

```json
{"to": "researcher", "summary": "assign task 1", "message": "start on task #1"}
```

| `to` | |
|---|---|
| `"researcher"` | Teammate by name |
| `"*"` | Broadcast to all teammates — expensive (linear in team size), use only when everyone genuinely needs it |
| `"uds:/path/to.sock"` | Local Claude session's socket (same machine; use `ListPeers`) |
| `"bridge:session_..."` | Remote Control peer session (cross-machine; use `ListPeers`) |

Your plain text output is NOT visible to other agents — to communicate, you MUST call this tool. Messages from teammates are delivered automatically; you don't check an inbox. Refer to teammates by name, never by UUID. When relaying, don't quote the original — it's already rendered to the user.

## Cross-session

Use `ListPeers` to discover targets, then:

```json
{"to": "uds:/tmp/cc-socks/1234.sock", "message": "check if tests pass over there"}
{"to": "bridge:session_01AbCd...", "message": "what branch are you on?"}
```

A listed peer is alive and will process your message — no "busy" state; messages enqueue and drain at the receiver's next tool round. Your message arrives wrapped as `<cross-session-message from="...">`. **To reply to an incoming message, copy its `from` attribute as your `to`.**

## Protocol responses (legacy)

If you receive a JSON message with `type: "shutdown_request"` or `type: "plan_approval_request"`, respond with the matching `_response` type — echo the `request_id`, set `approve` true/false:

```json
{"to": "team-lead", "message": {"type": "shutdown_response", "request_id": "...", "approve": true}}
{"to": "researcher", "message": {"type": "plan_approval_response", "request_id": "...", "approve": false, "feedback": "add error handling"}}
```

Approving shutdown terminates your process. Rejecting plan sends the teammate back to revise. Don't originate `shutdown_request` unless asked. Don't send structured JSON status messages — use TaskUpdate.
````

（UDS 关闭时省略 `| "uds:..." |` 与 `| "bridge:..." |` 两行及整个 `## Cross-session` 段。）

## Input Schema

- `to` (string, 必填): UDS 开启版：`"Recipient: teammate name, \"*\" for broadcast, \"uds:<socket-path>\" for a local peer, \"bridge:<session-id>\" for a Remote Control peer`（`LAN_PIPES` 开启时再附加 `, or "tcp:<host>:<port>" for a LAN peer`）` (use ListPeers to discover)`；UDS 关闭版："Recipient: teammate name, or \"*\" for broadcast to all teammates"
- `summary` (string, 可选): "A 5-10 word summary shown as a preview in the UI (required when message is a string)"
- `message` (string 或结构化对象, 必填): 字符串分支："Plain text message content"；结构化分支为 discriminated union（`type` 判别，字段无 `.describe()`）：
  - `shutdown_request`: `{ type, reason?: string }`
  - `shutdown_response`: `{ type, request_id: string, approve: semanticBoolean, reason?: string }`
  - `plan_approval_response`: `{ type, request_id: string, approve: semanticBoolean, feedback?: string }`
