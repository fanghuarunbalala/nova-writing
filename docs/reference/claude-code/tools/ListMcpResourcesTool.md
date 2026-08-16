# ListMcpResourcesTool

- **工具名**: `ListMcpResourcesTool`（userFacingName: `listMcpResources`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/ListMcpResourcesTool/`
- **门槛**: 无条件列于 `getAllBaseTools`（`vendor/claude-code/src/tools.ts` 第 275 行），但被 `getTools` 的 `specialTools` 集合过滤；实际生效是当有 MCP 服务器以 resources capability 连接后，由 `vendor/claude-code/src/services/mcp/client.ts` 动态加入（`resourceTools.push(ListMcpResourcesTool, ReadMcpResourceTool)`）
- **性质**: 只读（`isReadOnly: true`）；并发安全（`isConcurrencySafe: true`）；`shouldDefer: true`

## 描述（模型侧 desc）

`prompt.ts` 中 `DESCRIPTION` 常量，`description()` 返回它：

```

Lists available resources from configured MCP servers.
Each resource object includes a 'server' field indicating which server it's from.

Usage examples:
- List all resources from all servers: `listMcpResources`
- List resources from a specific server: `listMcpResources({ server: "myserver" })`
```

`prompt()` 返回 `prompt.ts` 中的 `PROMPT` 常量：

```

List available resources from configured MCP servers.
Each returned resource will include all standard MCP resource fields plus a 'server' field 
indicating which server the resource belongs to.

Parameters:
- server (optional): The name of a specific MCP server to get resources from. If not provided,
  resources from all servers will be returned.
```

## Input Schema

- `server` (string, 可选): "Optional server name to filter resources by"
