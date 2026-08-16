# ListPeersTool

- **工具名**: `ListPeers`（userFacingName: `ListPeers`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/ListPeersTool/`
- **门槛**: `feature('UDS_INBOX')`（`vendor/claude-code/src/tools.ts` getAllBaseTools 中 `...(ListPeersTool ? [ListPeersTool] : [])`）
- **性质**: 只读（`isReadOnly: true`）；并发安全（`isConcurrencySafe: true`）；`strict: true`

## 描述（模型侧 desc）

`description()` 返回（定义于 `ListPeersTool.ts` 的 `buildTool` 中）：

```
Discover other Claude Code sessions for cross-session messaging
```

`prompt()` 返回（同文件 `buildTool` 中内联文本）：

```
List active Claude Code sessions that can receive messages via SendMessage.

Returns an array of peers with their addresses. Use these addresses as the `to` field in SendMessage:
- `"uds:/path/to.sock"` — local sessions on the same machine (Unix Domain Socket)
- `"bridge:session_..."` — remote sessions via Remote Control

Use this tool to discover messaging targets before sending cross-session messages. Only running sessions with active messaging sockets are returned.
```

## Input Schema

- `include_self` (boolean, 可选): "Whether to include the current session in the list. Defaults to false."
