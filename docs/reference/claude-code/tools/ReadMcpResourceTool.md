# ReadMcpResourceTool

- **工具名**: `ReadMcpResourceTool`（userFacingName: `readMcpResource`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/ReadMcpResourceTool/`
- **门槛**: 无条件列于 `getAllBaseTools`（`vendor/claude-code/src/tools.ts` 第 276 行），但被 `getTools` 的 `specialTools` 集合过滤；实际生效是当有 MCP 服务器以 resources capability 连接后，由 `vendor/claude-code/src/services/mcp/client.ts` 动态加入（`resourceTools.push(ListMcpResourcesTool, ReadMcpResourceTool)`）
- **性质**: 只读（`isReadOnly: true`）；并发安全（`isConcurrencySafe: true`）；`shouldDefer: true`

## 描述（模型侧 desc）

`prompt.ts` 中 `DESCRIPTION` 常量，`description()` 返回它：

```

Reads a specific resource from an MCP server.
- server: The name of the MCP server to read from
- uri: The URI of the resource to read

Usage examples:
- Read a resource from a server: `readMcpResource({ server: "myserver", uri: "my-resource-uri" })`
```

`prompt()` 返回 `prompt.ts` 中 `PROMPT` 常量：

```

Reads a specific resource from an MCP server, identified by server name and resource URI.

Parameters:
- server (required): The name of the MCP server from which to read the resource
- uri (required): The URI of the resource to read
```

## Input Schema

- `server` (string, 必填): "The MCP server name"
- `uri` (string, 必填): "The resource URI to read"
